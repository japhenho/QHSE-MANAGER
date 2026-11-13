import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@qhse/shared';
import type { AccessTokenClaims } from './access-token.service.js';

export const REQUIRED_PERMISSION_KEY = 'access:permission';
export const AUTHENTICATED_ONLY_KEY = 'access:authenticatedOnly';

/**
 * Declares the permission a route requires. A route that declares nothing (neither
 * this, nor `@AuthenticatedOnly()`, nor `@Public()`) is refused to everyone.
 */
export const RequirePermission = (permission: PermissionKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

/**
 * For the rare routes any signed-in user may call whatever their roles (their own
 * identity). Each use must be listed in the deny-by-default test.
 */
export const AuthenticatedOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, true);

/** Who is calling, as established by the access guard from the session. */
export interface Actor extends AccessTokenClaims {
  readonly permissions: ReadonlySet<PermissionKey>;
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<{ auth?: Actor }>().auth;
    if (!actor) throw new Error('@CurrentActor() used on a route without authentication');
    return actor;
  },
);
