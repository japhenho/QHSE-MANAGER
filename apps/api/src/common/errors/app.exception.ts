import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@qhse/shared';

const DEFAULT_STATUS: Record<ErrorCode, HttpStatus> = {
  [ERROR_CODES.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.CONFLICT]: HttpStatus.CONFLICT,
  [ERROR_CODES.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ERROR_CODES.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
};

export interface AppExceptionOptions {
  /** Overrides the HTTP status derived from the error code. */
  status?: HttpStatus;
  /** Client-safe, structured details (e.g. field errors). Never put internals here. */
  details?: unknown;
  cause?: unknown;
}

/**
 * Application error carrying a stable, machine-readable code.
 * Everything given here (message, details) is sent to the client as is.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options: AppExceptionOptions = {},
  ) {
    super(message, options.status ?? DEFAULT_STATUS[code], { cause: options.cause });
    this.details = options.details;
  }

  readonly details: unknown;
}
