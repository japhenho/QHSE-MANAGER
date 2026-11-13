import { jest } from '@jest/globals';
import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ERROR_CODES } from '@qhse/shared';
import { AppException } from '../errors/app.exception.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

function createHost(
  request: Record<string, unknown> = { id: 'req-123', method: 'GET', url: '/api/v1/things' },
  responseOverrides: Record<string, unknown> = {},
): { host: ArgumentsHost; captured: Captured } {
  const captured: Captured = {};
  const response = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return {
        json(body: Record<string, unknown>) {
          captured.body = body;
        },
      };
    },
    ...responseOverrides,
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter;
  let errorLog: jest.SpiedFunction<(...args: unknown[]) => void>;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter = new ApiExceptionFilter();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [new UnauthorizedException('Sign in first'), 401, ERROR_CODES.UNAUTHENTICATED, 'Sign in first'],
    [new ForbiddenException('Not allowed'), 403, ERROR_CODES.FORBIDDEN, 'Not allowed'],
    [new NotFoundException('Incident not found'), 404, ERROR_CODES.NOT_FOUND, 'Incident not found'],
    [new ConflictException('Already closed'), 409, ERROR_CODES.CONFLICT, 'Already closed'],
    [new HttpException('Slow down', 429), 429, ERROR_CODES.RATE_LIMITED, 'Slow down'],
    [new BadRequestException('Bad input'), 400, ERROR_CODES.BAD_REQUEST, 'Bad input'],
  ])('maps %p to its stable code', (exception, status, code, message) => {
    const { host, captured } = createHost();

    filter.catch(exception, host);

    expect(captured.status).toBe(status);
    expect(captured.body).toEqual({ code, message, requestId: 'req-123' });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('keeps the code and details of an AppException', () => {
    const { host, captured } = createHost();
    const details = [{ path: 'title', code: 'too_small', message: 'Too short' }];

    filter.catch(
      new AppException(ERROR_CODES.VALIDATION_FAILED, 'Request validation failed', { details }),
      host,
    );

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'Request validation failed',
      details,
      requestId: 'req-123',
    });
  });

  it('derives the HTTP status of an AppException from its code', () => {
    const { host, captured } = createHost();

    filter.catch(new AppException(ERROR_CODES.CONFLICT, 'Version mismatch'), host);

    expect(captured.status).toBe(HttpStatus.CONFLICT);
    expect(captured.body).toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('turns an unknown error into INTERNAL_ERROR without leaking anything', () => {
    const { host, captured } = createHost();
    const error = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');

    filter.catch(error, host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toEqual({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Internal server error',
      requestId: 'req-123',
    });
    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('stack');
  });

  it('logs server errors with the original error and the request id', () => {
    const { host } = createHost();
    const error = new Error('boom');

    filter.catch(error, host);

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-123',
      status: 500,
      err: error,
    });
  });

  it.each([['a string'], [undefined], [null], [{ status: 418 }], [42]])(
    'handles a thrown non-error value (%p) as INTERNAL_ERROR',
    (thrown) => {
      const { host, captured } = createHost();

      filter.catch(thrown, host);

      expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(captured.body).toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR });
    },
  );

  it('hides the message of 5xx HTTP exceptions', () => {
    const { host, captured } = createHost();

    filter.catch(new InternalServerErrorException('Table "users" is locked'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toEqual({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Internal server error',
      requestId: 'req-123',
    });
  });

  it('keeps status 503 with a generic message', () => {
    const { host, captured } = createHost();

    filter.catch(new ServiceUnavailableException('pg pool exhausted on db-primary'), host);

    expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(captured.body).toEqual({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable',
      requestId: 'req-123',
    });
  });

  it('never exposes details of a 5xx AppException', () => {
    const { host, captured } = createHost();

    filter.catch(
      new AppException(ERROR_CODES.SERVICE_UNAVAILABLE, 'Database unreachable', {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        details: { host: 'db-primary' },
      }),
      host,
    );

    expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(captured.body).toEqual({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable',
      requestId: 'req-123',
    });
  });

  it('replaces the parser message of HTTP-layer errors (malformed JSON) by a fixed one', () => {
    const { host, captured } = createHost();
    const parseError = Object.assign(new SyntaxError('Unexpected token } in JSON at position 9'), {
      status: 400,
      statusCode: 400,
      expose: true,
    });

    // This is how the Nest Express adapter hands body-parser errors to filters.
    filter.catch(new BadRequestException(parseError.message, { cause: parseError }), host);

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toEqual({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'Malformed request',
      requestId: 'req-123',
    });
  });

  it('never trusts a status carried by a non-HTTP exception', () => {
    const { host, captured } = createHost();

    filter.catch(Object.assign(new Error('internal'), { status: 400, expose: true }), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR });
  });

  it('omits requestId when the request has none', () => {
    const { host, captured } = createHost({ method: 'GET', url: '/' });

    filter.catch(new NotFoundException('Nope'), host);

    expect(captured.body).toEqual({ code: ERROR_CODES.NOT_FOUND, message: 'Nope' });
  });

  it('does not write a second response once headers are sent', () => {
    const { host, captured } = createHost(undefined, { headersSent: true });

    filter.catch(new Error('late failure'), host);

    expect(captured.status).toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('rethrows outside of an HTTP context', () => {
    const error = new Error('rpc failure');
    const host = { getType: () => 'rpc' } as unknown as ArgumentsHost;

    expect(() => filter.catch(error, host)).toThrow(error);
  });
});
