import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ApiError, ERROR_CODES, type ErrorCode } from '@qhse/shared';
import { AppException } from '../errors/app.exception.js';
import { getRequestId } from '../logging/request-id.js';

interface ResolvedError {
  status: number;
  body: Omit<ApiError, 'requestId'>;
}

/** Minimal response surface used by the filter (satisfied by Express). */
interface HttpResponseLike {
  headersSent?: boolean;
  status(code: number): { json(body: unknown): unknown };
}

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
};

/** Fixed messages for errors raised by the HTTP layer itself (body parser, ...). */
const TRANSPORT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Malformed request',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Request payload too large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported media type',
};

const INTERNAL_ERROR_MESSAGE = 'Internal server error';
const SERVICE_UNAVAILABLE_MESSAGE = 'Service temporarily unavailable';

/**
 * Single exit point for every error of the API.
 *
 * Always answers with the shared {@link ApiError} envelope. Client errors keep the
 * message chosen by the code that raised them; server errors are replaced by a
 * generic message so that no stack trace, SQL or internal detail can leak. The full
 * error is logged server-side with the request id for correlation.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // Only HTTP is exposed for now; never swallow errors of another transport.
      throw exception;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<{ id?: unknown; method?: string; url?: string }>();
    const response = http.getResponse<HttpResponseLike>();
    const requestId = getRequestId(request);
    const { status, body } = resolveError(exception);

    if (status >= 500) {
      this.logger.error(
        {
          requestId,
          method: request.method,
          path: request.url,
          status,
          err: exception instanceof Error ? exception : new Error(String(exception)),
        },
        'Request failed',
      );
    }

    if (response.headersSent) return;

    const payload: ApiError = { ...body, ...(requestId === undefined ? {} : { requestId }) };
    response.status(status).json(payload);
  }
}

export function resolveError(exception: unknown): ResolvedError {
  if (exception instanceof AppException) {
    const status = exception.getStatus();
    if (status >= 500) return serverError(status);
    return {
      status,
      body: {
        code: exception.code,
        message: exception.message,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return serverError(status);
    const message = isTransportError(exception)
      ? (TRANSPORT_ERROR_MESSAGES[status] ?? 'Request rejected')
      : exception.message;
    return { status, body: { code: codeForClientStatus(status), message } };
  }

  return serverError(HttpStatus.INTERNAL_SERVER_ERROR);
}

function serverError(status: number): ResolvedError {
  const unavailable = status === HttpStatus.SERVICE_UNAVAILABLE;
  return {
    status,
    body: {
      code: unavailable ? ERROR_CODES.SERVICE_UNAVAILABLE : ERROR_CODES.INTERNAL_ERROR,
      message: unavailable ? SERVICE_UNAVAILABLE_MESSAGE : INTERNAL_ERROR_MESSAGE,
    },
  };
}

/** Any other 4xx (400, 405, 413, 415, 422...) means the request itself was not acceptable. */
function codeForClientStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? ERROR_CODES.BAD_REQUEST;
}

/**
 * Nest wraps errors of the HTTP layer (body parser, URL decoding) into an
 * HttpException whose `cause` is the original `http-errors`-like object. Their
 * message is written by a parser, not by us: recognise them to answer a fixed text.
 */
function isTransportError(exception: HttpException): boolean {
  const { cause } = exception;
  if (!(cause instanceof Error)) return false;
  const { status, statusCode } = cause as { status?: unknown; statusCode?: unknown };
  return typeof status === 'number' || typeof statusCode === 'number';
}
