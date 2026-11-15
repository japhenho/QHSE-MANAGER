import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type Actor,
  AUTHENTICATED_ONLY_KEY,
  type PermissionRequirement,
  REQUIRED_PERMISSION_KEY,
} from './access.decorators.js';
import { AccessTokenService } from './access-token.service.js';
import { forbidden, unauthenticated } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export type AuthenticatedRequest = Request & { auth?: Actor };

const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/;

/**
 * Global access guard — authentication, then authorisation, deny by default:
 *  1. a route marked `@Public()` is open;
 *  2. any other route needs a valid access token of a live session (401 otherwise);
 *  3. it must then declare `@RequirePermission(...)`, held by the caller through their
 *     roles — for the whole tenant, or on some scope when the route filters by scope —
 *     or `@AuthenticatedOnly()`. A route that declares nothing is refused (403).
 * Session and permissions are read from the database on every request: a logout, a
 * disabled account or a removed role takes effect immediately.
 * The identity attached to the request is the only source of the tenant afterwards.
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
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw unauthenticated();

    const claims = await this.accessTokens.verify(token);
    if (!claims) throw unauthenticated();
    const grants = await this.auth.loadSessionGrants(claims);
    if (grants === null) throw unauthenticated();
    const permissions = grants.tenantWide();

    const required = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      AUTHENTICATED_ONLY_KEY,
      targets,
    );
    let allowed = authenticatedOnly === true;
    if (required !== undefined) {
      allowed = required.scoped
        ? !grants.scopeOf(required.permission).isEmpty
        : permissions.has(required.permission);
    }
    if (!allowed) throw forbidden();

    request.auth = {
      ...claims,
      permissions,
      scopeOf: (permission) => grants.scopeOf(permission),
    };
    return true;
  }
}
