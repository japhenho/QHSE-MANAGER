import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthSessionResponse,
  CurrentUserResponse,
  LoginRequest,
  PermissionKey,
} from '@qhse/shared';
import { AuditService } from '../audit/index.js';
import { Clock } from '../common/clock.js';
import { ENV, type Env } from '../config/index.js';
import { effectivePermissions } from '../rbac/permissions.js';
import {
  type RequestOrigin,
  runInTenantContext,
  TenantDatabase,
  TenantResolver,
  type TenantTransaction,
  uuidv7,
} from '../tenancy/index.js';
import { AccessTokenService, type AccessTokenClaims } from './access-token.service.js';
import { invalidCredentials, tooManyAttempts, unauthenticated } from './auth.errors.js';
import { DEFAULT_LOCKOUT_POLICY, lockSecondsAfter, MemoryLoginThrottle } from './login-throttle.js';
import { PasswordService } from './password.service.js';
import {
  formatRefreshCookie,
  generateRefreshToken,
  hashRefreshToken,
  parseRefreshCookie,
} from './refresh-token.js';

const DAY_MS = 24 * 3600 * 1000;

/** What the controller needs to answer and to set the refresh cookie. */
export interface IssuedSession {
  body: AuthSessionResponse;
  refreshCookie: string;
  refreshCookieMaxAgeSeconds: number;
}

type RefreshOutcome =
  | { kind: 'ok'; userId: string; sessionId: string; token: string; identity: CurrentUserResponse }
  | { kind: 'rejected' };

@Injectable()
export class AuthService {
  private readonly policy = DEFAULT_LOCKOUT_POLICY;
  private readonly unknownTenantThrottle = new MemoryLoginThrottle(this.policy);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
    private readonly db: TenantDatabase,
    private readonly tenants: TenantResolver,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ login

  async login(input: LoginRequest, origin: RequestOrigin): Promise<IssuedSession> {
    const { organization, email, password } = input;
    const now = this.clock.now();

    const tenantId = await this.tenants.resolveActiveTenantId(organization);
    if (tenantId === null) {
      // No tenant to keep a counter under: same policy, in memory, same answers.
      const key = `${organization}\n${email}`;
      const wait = this.unknownTenantThrottle.lockedFor(key, now);
      if (wait > 0) throw tooManyAttempts(wait);
      await this.passwords.verifyDummy(password);
      this.unknownTenantThrottle.registerFailure(key, now);
      throw invalidCredentials();
    }

    // Unit of work 1: read. The password is verified outside of any transaction, so no
    // pooled connection is held during the (deliberately slow) hash computation.
    const { throttle, user } = await runInTenantContext({ tenantId, request: origin }, () =>
      this.db.run(async (tx) => ({
        throttle: await tx.loginThrottle.findUnique({
          where: { tenantId_email: { tenantId, email } },
        }),
        user: await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } }),
      })),
    );

    if (throttle?.lockedUntil && throttle.lockedUntil > now) {
      throw tooManyAttempts(Math.ceil((throttle.lockedUntil.getTime() - now.getTime()) / 1000));
    }

    const loginAllowed =
      user !== null &&
      user.status === 'ACTIVE' &&
      user.archivedAt === null &&
      user.passwordHash !== null;
    let passwordMatches = false;
    if (loginAllowed && user.passwordHash !== null) {
      passwordMatches = await this.passwords.verify(user.passwordHash, password);
    } else {
      await this.passwords.verifyDummy(password);
    }

    if (!loginAllowed || !passwordMatches) {
      // Unit of work 2 (failure): committed BEFORE the error is thrown, otherwise the
      // counter and the audit event would be rolled back with it.
      await runInTenantContext({ tenantId, request: origin }, () =>
        this.db.run((tx) => this.registerFailure(tx, tenantId, email, user?.id ?? null, now)),
      );
      throw invalidCredentials();
    }

    // Unit of work 2 (success).
    return runInTenantContext({ tenantId, userId: user.id, request: origin }, () =>
      this.db.run(async (tx) => {
        await tx.loginThrottle.deleteMany({ where: { email } });

        const sessionId = uuidv7();
        await tx.authSession.create({
          data: {
            id: sessionId,
            tenantId,
            userId: user.id,
            expiresAt: new Date(now.getTime() + this.env.AUTH_SESSION_MAX_DAYS * DAY_MS),
          },
        });
        const token = await this.issueRefreshToken(tx, tenantId, sessionId, now);
        await this.audit.record(tx, {
          action: 'auth.login_succeeded',
          resource: { type: 'user', id: user.id },
          metadata: { sessionId },
        });

        const identity = await this.loadIdentity(tx, tenantId, user.id);
        return this.toIssuedSession(identity, { tenantId, userId: user.id, sessionId }, token);
      }),
    );
  }

  private async registerFailure(
    tx: TenantTransaction,
    tenantId: string,
    email: string,
    knownUserId: string | null,
    now: Date,
  ): Promise<void> {
    const staleBefore = new Date(now.getTime() - this.policy.resetAfterSeconds * 1000);
    // Atomic increment: two simultaneous failures both count.
    const rows = await tx.$queryRaw<{ failed_count: number }[]>`
      INSERT INTO login_throttles (id, tenant_id, email, failed_count, last_failed_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${email}, 1, ${now})
      ON CONFLICT (tenant_id, email) DO UPDATE
        SET failed_count = CASE WHEN login_throttles.last_failed_at < ${staleBefore}
                                THEN 1 ELSE login_throttles.failed_count + 1 END,
            last_failed_at = EXCLUDED.last_failed_at
      RETURNING failed_count`;
    const failedCount = rows[0]?.failed_count ?? 1;
    const lockSeconds = lockSecondsAfter(failedCount, this.policy);
    await tx.loginThrottle.updateMany({
      where: { email },
      data: { lockedUntil: lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000) : null },
    });
    // Counters of e-mails nobody retried for a day are useless: keep the table small.
    await tx.loginThrottle.deleteMany({ where: { lastFailedAt: { lt: staleBefore } } });

    // Only failures on an existing account are business events (ADR 0003, § 7).
    if (knownUserId !== null) {
      await this.audit.record(tx, {
        action: lockSeconds > 0 ? 'auth.account_locked' : 'auth.login_failed',
        actor: 'system',
        resource: { type: 'user', id: knownUserId },
        metadata: { failedCount, lockSeconds },
      });
    }
  }

  // ---------------------------------------------------------------- refresh

  async refresh(cookieValue: string | undefined, origin: RequestOrigin): Promise<IssuedSession> {
    const parsed = parseRefreshCookie(cookieValue);
    if (!parsed) throw unauthenticated();
    const { tenantId, token } = parsed;
    const now = this.clock.now();

    const outcome = await runInTenantContext({ tenantId, request: origin }, () =>
      this.db.run((tx) => this.rotate(tx, tenantId, token, now)),
    );
    if (outcome.kind !== 'ok') throw unauthenticated();

    return this.toIssuedSession(
      outcome.identity,
      { tenantId, userId: outcome.userId, sessionId: outcome.sessionId },
      outcome.token,
    );
  }

  /** Runs in one transaction; every rejection path COMMITS what it wrote (revocation, audit). */
  private async rotate(
    tx: TenantTransaction,
    tenantId: string,
    token: string,
    now: Date,
  ): Promise<RefreshOutcome> {
    const tokenHash = hashRefreshToken(token);
    // Row lock: two requests presenting the same token are processed one after the other.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const tokenId = locked[0]?.id;
    if (tokenId === undefined) return { kind: 'rejected' };

    const current = await tx.refreshToken.findUnique({ where: { id: tokenId } });
    if (!current) return { kind: 'rejected' };
    const session = await tx.authSession.findUnique({ where: { id: current.sessionId } });
    if (!session || session.revokedAt !== null || session.expiresAt <= now)
      return { kind: 'rejected' };

    const user = await tx.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'ACTIVE' || user.archivedAt !== null) {
      await this.revokeSession(tx, session.id, 'user_disabled', now);
      return { kind: 'rejected' };
    }

    if (current.usedAt !== null) {
      const graceMs = this.env.AUTH_REFRESH_GRACE_SECONDS * 1000;
      const withinGrace = graceMs > 0 && now.getTime() - current.usedAt.getTime() <= graceMs;
      if (!withinGrace) {
        // A token that was already exchanged is presented again: it may have been
        // stolen. The whole session is closed and the event is recorded.
        await this.revokeSession(tx, session.id, 'reuse_detected', now);
        await this.audit.record(tx, {
          action: 'auth.refresh_reuse_detected',
          actor: 'system',
          resource: { type: 'auth_session', id: session.id },
          metadata: { userId: user.id },
        });
        return { kind: 'rejected' };
      }
      // Within the grace window the response to the first exchange was probably lost
      // (poor connectivity): a new successor is issued instead of logging the user out.
    } else {
      if (current.expiresAt <= now) return { kind: 'rejected' };
      await tx.refreshToken.update({ where: { id: current.id }, data: { usedAt: now } });
    }

    const successor = await this.issueRefreshToken(tx, tenantId, session.id, now);
    const identity = await this.loadIdentity(tx, tenantId, user.id);
    return { kind: 'ok', userId: user.id, sessionId: session.id, token: successor, identity };
  }

  // ----------------------------------------------------------------- logout

  /** Idempotent: an unknown, expired or already revoked token is simply ignored. */
  async logout(cookieValue: string | undefined, origin: RequestOrigin): Promise<void> {
    const parsed = parseRefreshCookie(cookieValue);
    if (!parsed) return;
    const { tenantId, token } = parsed;
    const now = this.clock.now();

    const session = await runInTenantContext({ tenantId, request: origin }, () =>
      this.db.run(async (tx) => {
        const row = await tx.refreshToken.findUnique({
          where: { tokenHash: hashRefreshToken(token) },
        });
        return row ? tx.authSession.findUnique({ where: { id: row.sessionId } }) : null;
      }),
    );
    if (!session || session.revokedAt !== null) return;

    await runInTenantContext({ tenantId, userId: session.userId, request: origin }, () =>
      this.db.run(async (tx) => {
        const revoked = await this.revokeSession(tx, session.id, 'logout', now);
        if (revoked) {
          await this.audit.record(tx, {
            action: 'auth.logout',
            resource: { type: 'auth_session', id: session.id },
          });
        }
      }),
    );
  }

  // ------------------------------------------------- per-request validation

  /**
   * Permissions of the user of an access token, or null when its session is no longer
   * usable. Read on every request so that a logout, a revocation, a disabled account or
   * a removed role takes effect at once, without waiting for the token to expire.
   */
  async loadSessionPermissions(
    claims: AccessTokenClaims,
  ): Promise<ReadonlySet<PermissionKey> | null> {
    const now = this.clock.now();
    return runInTenantContext({ tenantId: claims.tenantId }, () =>
      this.db.run(async (tx) => {
        const session = await tx.authSession.findUnique({ where: { id: claims.sessionId } });
        if (!session || session.userId !== claims.userId) return null;
        if (session.revokedAt !== null || session.expiresAt <= now) return null;
        const user = await tx.user.findUnique({ where: { id: claims.userId } });
        if (user === null || user.status !== 'ACTIVE' || user.archivedAt !== null) return null;
        return effectivePermissions(tx, claims.userId);
      }),
    );
  }

  /** Identity of the current context (the tenant context must already be established). */
  currentIdentity(tenantId: string, userId: string): Promise<CurrentUserResponse> {
    return this.db.run((tx) => this.loadIdentity(tx, tenantId, userId));
  }

  // ---------------------------------------------------------------- helpers

  private async issueRefreshToken(
    tx: TenantTransaction,
    tenantId: string,
    sessionId: string,
    now: Date,
  ): Promise<string> {
    const token = generateRefreshToken();
    await tx.refreshToken.create({
      data: {
        id: uuidv7(),
        tenantId,
        sessionId,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(now.getTime() + this.env.AUTH_REFRESH_IDLE_DAYS * DAY_MS),
      },
    });
    return token;
  }

  private async revokeSession(
    tx: TenantTransaction,
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<boolean> {
    const { count } = await tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return count > 0;
  }

  private async loadIdentity(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
  ): Promise<CurrentUserResponse> {
    const [user, tenant] = [
      await tx.user.findUnique({ where: { id: userId } }),
      await tx.tenant.findUnique({ where: { id: tenantId } }),
    ];
    if (!user || !tenant) throw unauthenticated();
    return {
      user: { id: user.id, email: user.email },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      permissions: [...(await effectivePermissions(tx, userId))].sort(),
    };
  }

  private async toIssuedSession(
    identity: CurrentUserResponse,
    claims: AccessTokenClaims,
    refreshToken: string,
  ): Promise<IssuedSession> {
    return {
      body: {
        accessToken: await this.accessTokens.sign(claims),
        expiresIn: this.accessTokens.ttlSeconds,
        ...identity,
      },
      refreshCookie: formatRefreshCookie(claims.tenantId, refreshToken),
      refreshCookieMaxAgeSeconds: this.env.AUTH_REFRESH_IDLE_DAYS * 24 * 3600,
    };
  }
}
