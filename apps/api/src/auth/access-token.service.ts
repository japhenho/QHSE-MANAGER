import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { Clock } from '../common/clock.js';
import { ENV, type Env } from '../config/index.js';
import { isUuid } from '../tenancy/index.js';

const ISSUER = 'qhse-manager';
const AUDIENCE = 'qhse-manager-api';
const ALGORITHM = 'HS256';

/** Identity carried by an access token. Permissions are never in the token. */
export interface AccessTokenClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

@Injectable()
export class AccessTokenService {
  private readonly signingKey: Uint8Array;
  private readonly verificationKeys: Uint8Array[];
  readonly ttlSeconds: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly clock: Clock,
  ) {
    const encoder = new TextEncoder();
    this.signingKey = encoder.encode(env.AUTH_JWT_SECRET);
    this.verificationKeys = [
      this.signingKey,
      ...(env.AUTH_JWT_SECRET_PREVIOUS ? [encoder.encode(env.AUTH_JWT_SECRET_PREVIOUS)] : []),
    ];
    this.ttlSeconds = env.AUTH_ACCESS_TOKEN_TTL_SECONDS;
  }

  sign(claims: AccessTokenClaims): Promise<string> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(this.signingKey);
  }

  /** Returns the claims of a valid token, or null (bad signature, expired, malformed…). */
  async verify(token: string): Promise<AccessTokenClaims | null> {
    for (const key of this.verificationKeys) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          audience: AUDIENCE,
          currentDate: this.clock.now(),
          requiredClaims: ['sub', 'exp', 'iat', 'tid', 'sid'],
        });
        const { sub, tid, sid } = payload;
        if (!isUuid(sub) || !isUuid(tid) || !isUuid(sid)) return null;
        return { userId: sub, tenantId: tid, sessionId: sid };
      } catch {
        // Try the next key; a token valid under none of them is rejected.
      }
    }
    return null;
  }
}
