import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type pg from 'pg';
import request from 'supertest';
import { RateLimiter } from '../src/auth/rate-limiter.service.js';
import { createTestApp, type TestApp } from './create-test-app.js';
import {
  type Account,
  FakeClock,
  login,
  me,
  openSession,
  refresh,
  refreshCookieOf,
  seedAccount,
} from './support/auth.js';
import { createOwnerClient, resetDatabase } from './support/db.js';
import { asTenant } from './support/tenants.js';

const DAY = 24 * 3600;

describe('authentication (ADR 0003)', () => {
  let app: TestApp;
  let clock: FakeClock;
  let owner: pg.Client;
  let alpha: Account;
  let bravo: Account;
  const logLines: string[] = [];

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    await owner.connect();
    alpha = await seedAccount(owner, 'auth-alpha');
    bravo = await seedAccount(owner, 'auth-bravo');
    clock = new FakeClock();
    app = await createTestApp(
      { LOG_LEVEL: 'info', API_CORS_ORIGINS: ['http://localhost:5173'] },
      { clock, logStream: { write: (line) => void logLines.push(line) } },
    );
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  beforeEach(() => {
    app.get(RateLimiter).reset();
  });

  async function auditEvents(account: Account, action: string) {
    return asTenant(owner, account.tenantId, async () => {
      const result = await owner.query(
        'SELECT * FROM audit_events WHERE action = $1 ORDER BY occurred_at',
        [action],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  async function setUser(account: Account, sql: string) {
    await asTenant(owner, account.tenantId, () =>
      owner.query(`UPDATE users SET ${sql} WHERE id = $1`, [account.userId]),
    );
  }

  // ------------------------------------------------------------------ login

  describe('login', () => {
    it('returns an access token, the identity, and an HttpOnly refresh cookie', async () => {
      const response = await login(app, alpha).expect(200);

      expect(response.body).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        expiresIn: 900,
        user: { id: alpha.userId, email: alpha.email },
        tenant: { id: alpha.tenantId, slug: 'auth-alpha', name: 'auth-alpha (DEMO)' },
        // No role yet: the account can log in but may do nothing else.
        permissions: [],
      });
      expect(response.headers['cache-control']).toBe('no-store');

      const cookie = refreshCookieOf(response);
      expect(cookie?.attributes).toContain('HttpOnly');
      expect(cookie?.attributes).toContain('SameSite=Strict');
      expect(cookie?.attributes).toContain('Path=/api/v1/auth');
      expect(cookie?.attributes).toMatch(/Max-Age=604800/);
      // The cookie carries the refresh token, never the access token.
      expect(cookie?.value).not.toContain(response.body.accessToken);
    });

    it('marks the cookie Secure when configured (production default)', async () => {
      const secureApp = await createTestApp({ AUTH_COOKIE_SECURE: true }, { clock });
      try {
        const response = await login(secureApp, alpha).expect(200);
        expect(refreshCookieOf(response)?.attributes).toContain('Secure');
      } finally {
        await secureApp.close();
      }
    });

    it('GET /auth/me returns the user and tenant of the session', async () => {
      const { accessToken } = await openSession(app, alpha);
      const response = await me(app, accessToken).expect(200);
      expect(response.body).toEqual({
        user: { id: alpha.userId, email: alpha.email },
        tenant: { id: alpha.tenantId, slug: 'auth-alpha', name: 'auth-alpha (DEMO)' },
        permissions: [],
      });
    });

    it('normalises the organisation code and e-mail typed by the user', async () => {
      await login(app, {
        organization: '  AUTH-Alpha ',
        email: ` ${alpha.email.toUpperCase()} `,
        password: alpha.password,
      }).expect(200);
    });

    it('answers identically for an unknown organisation, an unknown account and a wrong password', async () => {
      const attempts = await Promise.all([
        login(app, { ...alpha, organization: 'no-such-org' }),
        login(app, { ...alpha, email: 'nobody@auth-alpha.example.test' }),
        login(app, { ...alpha, password: 'wrong-password-123' }),
        // The right password of ANOTHER tenant's account must not help either.
        login(app, { ...alpha, password: bravo.password }),
      ]);

      for (const response of attempts) {
        expect(response.status).toBe(401);
        expect(refreshCookieOf(response)).toBeUndefined();
        const { requestId, ...body } = response.body;
        expect(requestId).toEqual(expect.any(String));
        expect(body).toEqual({ code: 'UNAUTHENTICATED', message: 'Invalid credentials' });
      }
    });

    it('answers the same way for a disabled account, an account without password and a suspended tenant', async () => {
      const disabled = await seedAccount(owner, 'auth-disabled');
      await setUser(disabled, `status = 'DISABLED'`);
      const noPassword = await seedAccount(owner, 'auth-nopass');
      await setUser(noPassword, 'password_hash = NULL');
      const suspended = await seedAccount(owner, 'auth-suspended');
      await owner.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [
        suspended.tenantId,
      ]);

      for (const account of [disabled, noPassword, suspended]) {
        const response = await login(app, account).expect(401);
        expect(response.body).toMatchObject({
          code: 'UNAUTHENTICATED',
          message: 'Invalid credentials',
        });
      }
    });

    it('validates the payload without echoing what was sent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ organization: 'x', email: 'not-an-email', password: '' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'email',
        'organization',
        'password',
      ]);
      expect(JSON.stringify(response.body)).not.toContain('not-an-email');
    });

    it('records the successful login in the audit log, with its origin', async () => {
      await login(app, bravo).set('User-Agent', 'audit-probe').expect(200);
      const events = await auditEvents(bravo, 'auth.login_succeeded');
      expect(events.at(-1)).toMatchObject({
        actor_type: 'USER',
        actor_user_id: bravo.userId,
        resource_type: 'user',
        resource_id: bravo.userId,
        user_agent: 'audit-probe',
      });
      expect(events.at(-1)?.['ip_address']).toEqual(expect.any(String));
    });
  });

  // ------------------------------------------------------- access tokens

  describe('access token', () => {
    it.each([
      ['no header', undefined],
      ['an empty bearer', 'Bearer '],
      ['another scheme', 'Basic dXNlcjpwYXNz'],
      ['garbage', 'Bearer not.a.jwt'],
    ])('rejects %s', async (_label, header) => {
      const call = request(app.getHttpServer()).get('/api/v1/auth/me');
      const response = await (header ? call.set('Authorization', header) : call).expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects a token whose tenant was modified', async () => {
      const { accessToken } = await openSession(app, alpha);
      const [header, payload, signature] = accessToken.split('.') as [string, string, string];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, tid: bravo.tenantId })).toString(
        'base64url',
      );

      await me(app, `${header}.${forged}.${signature}`).expect(401);
    });

    it('rejects a token signed with another key', async () => {
      const otherApp = await createTestApp(
        { AUTH_JWT_SECRET: 'another-key-'.repeat(4) },
        { clock },
      );
      try {
        const { accessToken } = await openSession(otherApp, alpha);
        await me(app, accessToken).expect(401);
      } finally {
        await otherApp.close();
      }
    });

    it('expires after its lifetime', async () => {
      const { accessToken } = await openSession(app, alpha);
      clock.advance(899);
      await me(app, accessToken).expect(200);
      clock.advance(2);
      await me(app, accessToken).expect(401);
    });

    it('CC-1: a token of tenant B only ever yields data of B', async () => {
      const sessionA = await openSession(app, alpha);
      const sessionB = await openSession(app, bravo);

      const fromB = await me(app, sessionB.accessToken).expect(200);
      expect(fromB.body.tenant.id).toBe(bravo.tenantId);
      expect(fromB.body.user.id).toBe(bravo.userId);
      expect(JSON.stringify(fromB.body)).not.toContain(alpha.tenantId);
      expect(JSON.stringify(fromB.body)).not.toContain(alpha.email);

      // Nothing the client sends can change the tenant of the request.
      const withHints = await me(app, sessionB.accessToken)
        .set('X-Tenant-Id', alpha.tenantId)
        .query({ tenantId: alpha.tenantId })
        .expect(200);
      expect(withHints.body.tenant.id).toBe(bravo.tenantId);

      const fromA = await me(app, sessionA.accessToken).expect(200);
      expect(fromA.body.tenant.id).toBe(alpha.tenantId);
    });

    it('stops working as soon as the account is disabled', async () => {
      const account = await seedAccount(owner, 'auth-turned-off');
      const session = await openSession(app, account);
      await me(app, session.accessToken).expect(200);

      await setUser(account, `status = 'DISABLED'`);

      await me(app, session.accessToken).expect(401);
      await refresh(app, session.cookie).expect(401);
    });
  });

  // ---------------------------------------------------------------- refresh

  describe('refresh token rotation', () => {
    it('exchanges the cookie for a new access token and a new cookie', async () => {
      const session = await openSession(app, alpha);
      const response = await refresh(app, session.cookie).expect(200);

      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        user: { id: alpha.userId },
        tenant: { id: alpha.tenantId },
      });
      const rotated = refreshCookieOf(response);
      expect(rotated?.value).toBeDefined();
      expect(rotated?.value).not.toBe(session.cookieValue);
      await me(app, response.body.accessToken).expect(200);
    });

    it('a used token no longer works; replaying it after the grace window revokes the whole session', async () => {
      const session = await openSession(app, alpha);
      const first = await refresh(app, session.cookie).expect(200);
      const successor = refreshCookieOf(first)?.pair as string;

      clock.advance(11); // grace window is 10 s
      const replay = await refresh(app, session.cookie).expect(401);
      expect(replay.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      // The browser is told to drop the refused cookie.
      expect(refreshCookieOf(replay)?.value).toBe('');

      // The legitimate successor and the access token die with the session.
      await refresh(app, successor).expect(401);
      await me(app, first.body.accessToken).expect(401);

      const events = await auditEvents(alpha, 'auth.refresh_reuse_detected');
      expect(events.at(-1)).toMatchObject({
        actor_type: 'SYSTEM',
        resource_type: 'auth_session',
        metadata: { userId: alpha.userId },
      });
    });

    it('grace window: an immediate replay of the previous token does not log the user out', async () => {
      const session = await openSession(app, alpha);
      const first = await refresh(app, session.cookie).expect(200);

      clock.advance(3);
      const replay = await refresh(app, session.cookie).expect(200);

      await me(app, replay.body.accessToken).expect(200);
      await me(app, first.body.accessToken).expect(200);
      // Both successors keep working: the session was not revoked.
      await refresh(app, refreshCookieOf(replay)?.pair as string).expect(200);
    });

    it('the grace window is configurable: with 0 seconds an immediate replay revokes the session', async () => {
      const strictApp = await createTestApp({ AUTH_REFRESH_GRACE_SECONDS: 0 }, { clock });
      try {
        const session = await openSession(strictApp, alpha);
        const first = await refresh(strictApp, session.cookie).expect(200);
        await refresh(strictApp, session.cookie).expect(401);
        await me(strictApp, first.body.accessToken).expect(401);
      } finally {
        await strictApp.close();
      }
    });

    it('CC-1: a refresh token of tenant A presented as tenant B is refused, and A is unaffected', async () => {
      const session = await openSession(app, alpha);
      const token = session.cookieValue.slice(session.cookieValue.indexOf('.') + 1);

      await refresh(app, `qhse_refresh=${bravo.tenantId}.${token}`).expect(401);

      await refresh(app, session.cookie).expect(200);
    });

    it.each([
      ['no cookie', ''],
      ['a malformed cookie', 'qhse_refresh=garbage'],
      [
        'an unknown token',
        `qhse_refresh=${'0193a000-0000-7000-8000-000000000000'}.${'a'.repeat(43)}`,
      ],
    ])('rejects %s', async (_label, cookie) => {
      await refresh(app, cookie).expect(401);
    });

    it('ends after the inactivity period', async () => {
      const session = await openSession(app, alpha);
      clock.advance(7 * DAY + 60);
      await refresh(app, session.cookie).expect(401);
    });

    it('ends at the absolute session lifetime even when used regularly', async () => {
      let cookie = (await openSession(app, alpha)).cookie;
      for (let week = 0; week < 5; week += 1) {
        clock.advance(6 * DAY);
        app.get(RateLimiter).reset();
        const response = await refresh(app, cookie);
        if (week < 4) {
          expect(response.status).toBe(200);
          cookie = refreshCookieOf(response)?.pair as string;
        } else {
          expect(response.status).toBe(401); // day 30 reached
        }
      }
    });

    it('refuses a browser request coming from an origin outside the allow-list', async () => {
      const session = await openSession(app, alpha);

      const evil = await refresh(app, session.cookie)
        .set('Origin', 'https://evil.example')
        .expect(403);
      expect(evil.body).toMatchObject({ code: 'FORBIDDEN' });
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'https://evil.example')
        .expect(403);

      // The session is intact and the allowed origin works.
      await refresh(app, session.cookie).set('Origin', 'http://localhost:5173').expect(200);
    });
  });

  // ----------------------------------------------------------------- logout

  describe('logout', () => {
    it('ends the session: cookie cleared, refresh and access token refused, event recorded', async () => {
      const session = await openSession(app, bravo);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .expect(204);
      expect(refreshCookieOf(response)?.value).toBe('');

      await refresh(app, session.cookie).expect(401);
      await me(app, session.accessToken).expect(401);

      const events = await auditEvents(bravo, 'auth.logout');
      expect(events.at(-1)).toMatchObject({ actor_type: 'USER', actor_user_id: bravo.userId });
    });

    it('is idempotent and never fails', async () => {
      const session = await openSession(app, bravo);
      const before = (await auditEvents(bravo, 'auth.logout')).length;

      for (const cookie of [session.cookie, session.cookie, 'qhse_refresh=garbage', '']) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .expect(204);
      }
      expect((await auditEvents(bravo, 'auth.logout')).length).toBe(before + 1);
    });

    it('does not end the other sessions of the user', async () => {
      const first = await openSession(app, bravo);
      const second = await openSession(app, bravo);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', first.cookie)
        .expect(204);

      await me(app, second.accessToken).expect(200);
    });
  });

  // ------------------------------------------------- lockout and rate limit

  describe('progressive lockout', () => {
    const fail = (account: Pick<Account, 'organization' | 'email'>) =>
      login(app, { ...account, password: 'wrong-password-123' });

    it('after 5 failures the account is locked, for longer at every further failure', async () => {
      const account = await seedAccount(owner, 'auth-lockout');
      for (let i = 0; i < 5; i += 1) await fail(account).expect(401);

      // Locked: even the right password is refused, with the time to wait.
      const locked = await login(app, account).expect(429);
      expect(locked.body).toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: 60 },
      });
      expect(locked.headers['retry-after']).toBe('60');

      clock.advance(30);
      expect((await fail(account).expect(429)).headers['retry-after']).toBe('30');

      clock.advance(31);
      await fail(account).expect(401); // 6th failure: lock doubles
      expect((await login(app, account).expect(429)).headers['retry-after']).toBe('120');

      clock.advance(121);
      await login(app, account).expect(200); // success resets the counter
      for (let i = 0; i < 4; i += 1) await fail(account).expect(401);
      await login(app, account).expect(200);

      const events = await auditEvents(account, 'auth.account_locked');
      expect(events.map((event) => event['metadata'])).toEqual([
        { failedCount: 5, lockSeconds: 60 },
        { failedCount: 6, lockSeconds: 120 },
      ]);
      expect((await auditEvents(account, 'auth.login_failed')).length).toBe(8);
    });

    it('behaves identically for an account that does not exist and for an unknown organisation', async () => {
      const account = await seedAccount(owner, 'auth-lockout-two');
      const ghosts = [
        { organization: account.organization, email: 'ghost@auth-lockout-two.example.test' },
        { organization: 'no-such-organisation', email: 'ghost@nowhere.example.test' },
      ];

      for (const ghost of ghosts) {
        for (let i = 0; i < 5; i += 1) await fail(ghost).expect(401);
        const locked = await fail(ghost).expect(429);
        expect(locked.body).toMatchObject({
          code: 'RATE_LIMITED',
          details: { retryAfterSeconds: 60 },
        });
      }

      // The real account of the same tenant is not affected, and nothing was audited
      // for the non-existent account.
      await login(app, account).expect(200);
      expect(await auditEvents(account, 'auth.login_failed')).toEqual([]);
    });
  });

  describe('rate limiting per client address', () => {
    it('answers 429 RATE_LIMITED beyond 20 login attempts per minute', async () => {
      for (let i = 0; i < 20; i += 1) {
        await login(app, {
          organization: `rate-org-${String(i)}`,
          email: 'x@example.test',
          password: 'x',
        }).expect(401);
      }
      const limited = await login(app, alpha).expect(429);
      expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      clock.advance(61);
      await login(app, alpha).expect(200);
    });
  });

  // ------------------------------------------------------ deny by default

  describe('CC-2: every route requires authentication unless explicitly public', () => {
    const PUBLIC_ROUTES = new Set([
      'GET /api/v1/health/live',
      'GET /api/v1/health/ready',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/logout',
    ]);

    it('answers 401 without a token on every other registered route', async () => {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
      const routes = Object.entries(document.paths).flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
      );

      // The list of public routes is exact: adding a public route must be a decision.
      expect(routes.filter((route) => PUBLIC_ROUTES.has(route)).sort()).toEqual(
        [...PUBLIC_ROUTES].sort(),
      );

      const protectedRoutes = routes.filter((route) => !PUBLIC_ROUTES.has(route));
      expect(protectedRoutes).toContain('GET /api/v1/auth/me');
      for (const route of protectedRoutes) {
        const [method, path] = route.split(' ') as [string, string];
        const url = path.replace(/\{[^}]+\}/g, '0193a000-0000-7000-8000-000000000000');
        const response = await request(app.getHttpServer())[method.toLowerCase() as 'get'](url);
        expect([route, response.status]).toEqual([route, 401]);
        expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      }
    });
  });

  // ------------------------------------------------------------------- logs

  describe('logs', () => {
    it('contain no password, hash, access token nor refresh token', async () => {
      logLines.length = 0;
      const response = await login(app, alpha).expect(200);
      const cookie = refreshCookieOf(response);
      const refreshed = await refresh(app, cookie?.pair as string).expect(200);
      await me(app, refreshed.body.accessToken).expect(200);
      await login(app, { ...alpha, password: 'a-wrong-secret-value' }).expect(401);

      const output = logLines.join('');
      expect(logLines.length).toBeGreaterThanOrEqual(4); // the requests were logged
      expect(output).toContain('/api/v1/auth/login');

      const hash = await asTenant(owner, alpha.tenantId, async () => {
        const result = await owner.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1',
          [alpha.userId],
        );
        return result.rows[0]?.password_hash as string;
      });
      const refreshToken = (cookie?.value as string).split('.')[1] as string;
      const secrets = {
        password: alpha.password,
        wrongPassword: 'a-wrong-secret-value',
        passwordHash: hash,
        accessToken: response.body.accessToken as string,
        refreshedAccessToken: refreshed.body.accessToken as string,
        refreshToken,
        rotatedRefreshToken: (refreshCookieOf(refreshed)?.value as string).split('.')[1] as string,
      };
      for (const [name, value] of Object.entries(secrets)) {
        expect([name, output.includes(value)]).toEqual([name, false]);
      }
      expect(output).toContain('[REDACTED]');
    });
  });
});
