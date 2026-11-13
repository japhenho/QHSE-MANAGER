import { ERROR_CODES, type ApiError, type ErrorCode } from '@qhse/shared';

/**
 * Why a request failed, from the user's point of view:
 * - `offline`: the device reports no connectivity, the request never left.
 * - `network`: the request could not reach the server (DNS, refused connection, CORS, drop).
 * - `timeout`: no complete response within the allotted time.
 * - `http`: the server answered with an error status (4xx/5xx).
 * - `invalid_response`: the server answered, but the body was not what we expect.
 */
export type ApiFailureKind = 'offline' | 'network' | 'timeout' | 'http' | 'invalid_response';

interface ApiRequestErrorInit {
  kind: ApiFailureKind;
  message: string;
  status?: number;
  apiError?: ApiError;
  cause?: unknown;
}

/** Single error type thrown by `apiFetch`. */
export class ApiRequestError extends Error {
  readonly kind: ApiFailureKind;
  /** HTTP status, when the server answered. */
  readonly status: number | undefined;
  /** Parsed API error envelope, when the server sent one. */
  readonly apiError: ApiError | undefined;

  constructor({ kind, message, status, apiError, cause }: ApiRequestErrorInit) {
    super(message, { cause });
    this.name = 'ApiRequestError';
    this.kind = kind;
    this.status = status;
    this.apiError = apiError;
  }

  /** Stable machine-readable code from the API envelope, if any. */
  get code(): ErrorCode | undefined {
    return this.apiError?.code;
  }

  /** Correlation id to quote to support, if the API provided one. */
  get requestId(): string | undefined {
    return this.apiError?.requestId;
  }

  /** True when retrying later may succeed without changing the request. */
  get isTransient(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    if (this.kind === 'http') {
      return this.status !== undefined && (this.status >= 500 || this.status === 429);
    }
    return false;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ERROR_CODES));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the body as an `ApiError` if it matches the shared envelope, otherwise `undefined`. */
export function parseApiErrorEnvelope(body: unknown): ApiError | undefined {
  if (!isRecord(body)) return undefined;
  const { code, message, details, requestId } = body;
  if (typeof code !== 'string' || !KNOWN_CODES.has(code) || typeof message !== 'string') {
    return undefined;
  }
  return {
    code: code as ErrorCode, // Narrowed by the KNOWN_CODES membership check above.
    message,
    ...(details !== undefined ? { details } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}
