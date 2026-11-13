import { SignJWT } from 'jose';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/index.js';
import { uuidv7 } from '../tenancy/index.js';
import { AccessTokenService } from './access-token.service.js';
import { PasswordService } from './password.service.js';
import { RateLimiter } from './rate-limiter.service.js';
import {
  formatRefreshCookie,
  generateRefreshToken,
  hashRefreshToken,
  parseRefreshCookie,
  readCookie,
} from './refresh-token.js';

class FakeClock extends Clock {
  current = new Date('2026-11-13T12:00:00Z');
  override now(): Date {
    return new Date(this.current);
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

const SECRET = 'unit-test-signing-key-not-a-secret-0123456789';
const env = (overrides: Partial<Env> = {}) =>
  ({
    AUTH_JWT_SECRET: SECRET,
    AUTH_JWT_SECRET_PREVIOUS: undefined,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
    ...overrides,
  }) as Env;

describe('AccessTokenService', () => {
  const claims = { userId: uuidv7(), tenantId: uuidv7(), sessionId: uuidv7() };

  it('round-trips the identity', async () => {
    const service = new AccessTokenService(env(), new FakeClock());
    expect(await service.verify(await service.sign(claims))).toEqual(claims);
  });

  it('rejects an expired token', async () => {
    const clock = new FakeClock();
    const service = new AccessTokenService(env(), clock);
    const token = await service.sign(claims);
    clock.advance(899);
    expect(await service.verify(token)).toEqual(claims);
    clock.advance(2);
    expect(await service.verify(token)).toBeNull();
  });

  it('rejects a token signed with another key', async () => {
    const other = new AccessTokenService(env({ AUTH_JWT_SECRET: 'x'.repeat(40) }), new FakeClock());
    const service = new AccessTokenService(env(), new FakeClock());
    expect(await service.verify(await other.sign(claims))).toBeNull();
  });

  it('rejects a token whose tenant was changed after signing', async () => {
    const service = new AccessTokenService(env(), new FakeClock());
    const [header, payload, signature] = (await service.sign(claims)).split('.') as [
      string,
      string,
      string,
    ];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        tid: uuidv7(),
      }),
    ).toString('base64url');
    expect(await service.verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('rejects an unsigned token and a token with another algorithm', async () => {
    const service = new AccessTokenService(env(), new FakeClock());
    const body = Buffer.from(
      JSON.stringify({ sub: claims.userId, tid: claims.tenantId, sid: claims.sessionId }),
    ).toString('base64url');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${body}.`;
    expect(await service.verify(none)).toBeNull();

    const hs512 = await new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(claims.userId)
      .setIssuer('qhse-manager')
      .setAudience('qhse-manager-api')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET.repeat(2)));
    expect(await service.verify(hs512)).toBeNull();
  });

  it('rejects a well-signed token with malformed or missing claims', async () => {
    const service = new AccessTokenService(env(), new FakeClock());
    const sign = (payload: Record<string, unknown>, subject?: string) => {
      const jwt = new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('qhse-manager')
        .setAudience('qhse-manager-api')
        .setIssuedAt(Math.floor(new FakeClock().now().getTime() / 1000))
        .setExpirationTime(Math.floor(new FakeClock().now().getTime() / 1000) + 60);
      if (subject) jwt.setSubject(subject);
      return jwt.sign(new TextEncoder().encode(SECRET));
    };
    expect(
      await service.verify(await sign({ tid: 'nope', sid: claims.sessionId }, claims.userId)),
    ).toBeNull();
    expect(await service.verify(await sign({ tid: claims.tenantId }, claims.userId))).toBeNull();
    expect(
      await service.verify(await sign({ tid: claims.tenantId, sid: claims.sessionId })),
    ).toBeNull();
    expect(await service.verify('garbage')).toBeNull();
  });

  it('still accepts the previous key during a rotation, and signs with the new one', async () => {
    const before = new AccessTokenService(env(), new FakeClock());
    const after = new AccessTokenService(
      env({ AUTH_JWT_SECRET: 'n'.repeat(40), AUTH_JWT_SECRET_PREVIOUS: SECRET }),
      new FakeClock(),
    );
    expect(await after.verify(await before.sign(claims))).toEqual(claims);
    expect(await before.verify(await after.sign(claims))).toBeNull();
  });
});

describe('refresh token helpers', () => {
  it('generates distinct 256-bit URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateRefreshToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores a hash that is not the token', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).not.toContain(token);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('round-trips the cookie value', () => {
    const tenantId = uuidv7();
    const token = generateRefreshToken();
    expect(parseRefreshCookie(formatRefreshCookie(tenantId, token))).toEqual({ tenantId, token });
  });

  it.each([
    undefined,
    '',
    'no-separator',
    `not-a-uuid.${'a'.repeat(43)}`,
    `${uuidv7()}.short`,
    `${uuidv7()}.${'a'.repeat(42)}!`,
  ])('rejects the cookie value %p', (value) => {
    expect(parseRefreshCookie(value)).toBeNull();
  });

  it('reads one cookie among several', () => {
    expect(readCookie('a=1; qhse_refresh=abc.def; b=2', 'qhse_refresh')).toBe('abc.def');
    expect(readCookie('xqhse_refresh=nope', 'qhse_refresh')).toBeUndefined();
    expect(readCookie(undefined, 'qhse_refresh')).toBeUndefined();
  });
});

describe('PasswordService', () => {
  it('hashes with Argon2id and verifies', async () => {
    const service = new PasswordService();
    await service.onModuleInit();
    const hash = await service.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('correct horse');
    expect(await service.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await service.verify(hash, 'correct horse battery stapler')).toBe(false);
  });

  it('salts: the same password gives different hashes', async () => {
    const service = new PasswordService();
    expect(await service.hash('same password 123')).not.toBe(
      await service.hash('same password 123'),
    );
  });

  it('a malformed stored hash never matches and never throws', async () => {
    const service = new PasswordService();
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
  });
});

describe('RateLimiter', () => {
  const rule = { name: 'test', limit: 3, windowSeconds: 60 };

  it('allows the limit, then asks to wait until the window ends', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock);
    expect([1, 2, 3].map(() => limiter.consume(rule, 'ip'))).toEqual([0, 0, 0]);
    expect(limiter.consume(rule, 'ip')).toBe(60);
    clock.advance(45);
    expect(limiter.consume(rule, 'ip')).toBe(15);
    clock.advance(15);
    expect(limiter.consume(rule, 'ip')).toBe(0);
  });

  it('counts keys and rules separately', () => {
    const limiter = new RateLimiter(new FakeClock());
    for (let i = 0; i < 3; i += 1) limiter.consume(rule, 'ip-1');
    expect(limiter.consume(rule, 'ip-2')).toBe(0);
    expect(limiter.consume({ ...rule, name: 'other' }, 'ip-1')).toBe(0);
  });
});
