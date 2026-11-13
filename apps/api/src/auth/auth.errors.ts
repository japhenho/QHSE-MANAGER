import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@qhse/shared';
import { AppException } from '../common/errors/app.exception.js';

/**
 * One single answer for an unknown organisation, an unknown account, a disabled account
 * and a wrong password: the caller must not be able to tell them apart.
 */
export function invalidCredentials(): AppException {
  return new AppException(ERROR_CODES.UNAUTHENTICATED, 'Invalid credentials');
}

export function unauthenticated(): AppException {
  return new AppException(ERROR_CODES.UNAUTHENTICATED, 'Authentication required');
}

export function tooManyAttempts(retryAfterSeconds: number): AppException {
  return new AppException(ERROR_CODES.RATE_LIMITED, 'Too many attempts, try again later', {
    status: HttpStatus.TOO_MANY_REQUESTS,
    details: { retryAfterSeconds },
  });
}

/** Same answer whether the permission is missing or the route declares none. */
export function forbidden(): AppException {
  return new AppException(ERROR_CODES.FORBIDDEN, 'You are not allowed to do this');
}

export function forbiddenOrigin(): AppException {
  return new AppException(ERROR_CODES.FORBIDDEN, 'Origin not allowed');
}

/** Reads `retryAfterSeconds` from a RATE_LIMITED exception, to set the Retry-After header. */
export function retryAfterOf(error: unknown): number | undefined {
  if (!(error instanceof AppException) || error.code !== ERROR_CODES.RATE_LIMITED) return undefined;
  const details = error.details as { retryAfterSeconds?: unknown } | undefined;
  return typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : undefined;
}
