import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessTokenService, type AccessTokenClaims } from './access-token.service.js';
import { unauthenticated } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export type AuthenticatedRequest = Request & { auth?: AccessTokenClaims };

const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/;

/**
 * Global guard: every route requires a valid access token of a live session, unless it
 * is explicitly marked `@Public()`. The identity it attaches to the request is the only
 * source of the tenant for the rest of the request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw unauthenticated();

    const claims = await this.accessTokens.verify(token);
    if (!claims || !(await this.auth.isSessionActive(claims))) throw unauthenticated();

    request.auth = claims;
    return true;
  }
}
