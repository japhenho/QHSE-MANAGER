import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@qhse/shared';
import type { AccessScope } from '../rbac/access-scope.js';
import type { AccessTokenClaims } from './access-token.service.js';

export const REQUIRED_PERMISSION_KEY = 'access:permission';
export const AUTHENTICATED_ONLY_KEY = 'access:authenticatedOnly';

/**
 * Declares the permission a route requires — for the whole tenant unless `scoped` is
 * set. A route that declares nothing (neither
 * this, nor `@AuthenticatedOnly()`, nor `@Public()`) is refused to everyone.
 */
export interface PermissionRequirement {
  readonly permission: PermissionKey;
  /**
   * False (default): the permission must be held for the WHOLE tenant.
   * True: holding it on any scope (a company, a site, a department) lets the request
   * in, and the handler MUST restrict what it reads and writes with
   * `actor.scopeOf(permission)`. Use it only for resources located in the organisation.
   */
  readonly scoped: boolean;
}

export const RequirePermission = (
  permission: PermissionKey,
  options: { scoped?: boolean } = {},
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PermissionRequirement>(REQUIRED_PERMISSION_KEY, {
    permission,
    scoped: options.scoped ?? false,
  });

/**
 * For the rare routes any signed-in user may call whatever their roles (their own
 * identity). Each use must be listed in the deny-by-default test.
 */
export const AuthenticatedOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, true);

/** Who is calling, as established by the access guard from the session. */
export interface Actor extends AccessTokenClaims {
  /** Permissions held for the whole tenant. */
  readonly permissions: ReadonlySet<PermissionKey>;
  /** Where a permission applies (possibly nowhere). */
  scopeOf(permission: PermissionKey): AccessScope;
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<{ auth?: Actor }>().auth;
    if (!actor) throw new Error('@CurrentActor() used on a route without authentication');
    return actor;
  },
);
