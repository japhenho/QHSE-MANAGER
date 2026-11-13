import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marks a route as reachable without authentication. Every other route requires a
 * valid access token (deny by default). Use sparingly and justify each use.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
