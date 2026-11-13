import { getCurrentLocale } from '../../i18n';
import { getApiBaseUrl } from './config';
import { ApiRequestError, parseApiErrorEnvelope } from './errors';

/** Generous default for satellite / congested mobile links. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialisable request body. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Caller cancellation (TanStack Query passes one to every query function). */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiFetchParsedOptions<T> extends ApiFetchOptions {
  /** Validates/narrows the response body. Throw to reject an unexpected payload. */
  parse: (data: unknown) => T;
}

function buildUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new TypeError(`API path must start with "/": received "${path}"`);
  }
  return `${getApiBaseUrl()}${path}`;
}

function isJsonResponse(response: Response): boolean {
  return /\bjson\b/i.test(response.headers.get('content-type') ?? '');
}

async function readJsonBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  if (!isJsonResponse(response)) {
    throw new SyntaxError('Response is not JSON');
  }
  return JSON.parse(text) as unknown;
}

/**
 * Typed wrapper around `fetch` for the QHSE Manager API.
 *
 * - Resolves `path` against `VITE_API_BASE_URL`.
 * - Sends/receives JSON and advertises the UI language (`Accept-Language`).
 * - Aborts after `timeoutMs`.
 * - Always rejects with an `ApiRequestError` whose `kind` tells offline, network,
 *   timeout, HTTP error and malformed response apart. The only other rejection is the
 *   native `AbortError` when the caller's own `signal` is aborted.
 *
 * Without `parse` the body is returned as `unknown`: callers must validate before use.
 */
export function apiFetch<T>(path: string, options: ApiFetchParsedOptions<T>): Promise<T>;
export function apiFetch(path: string, options?: ApiFetchOptions): Promise<unknown>;
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions & { parse?: (data: unknown) => T } = {},
): Promise<unknown> {
  const { method = 'GET', body, headers, signal, timeoutMs = DEFAULT_TIMEOUT_MS, parse } = options;
  const url = buildUrl(path);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    let response: Response;
    let data: unknown;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Accept-Language': getCurrentLocale(),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      throw toTransportError(cause, { timedOut, callerAborted: signal?.aborted === true });
    }

    try {
      data = await readJsonBody(response);
    } catch (cause) {
      if (timedOut || signal?.aborted) {
        throw toTransportError(cause, { timedOut, callerAborted: signal?.aborted === true });
      }
      if (response.ok) {
        throw new ApiRequestError({
          kind: 'invalid_response',
          message: 'The server returned a body that is not valid JSON',
          status: response.status,
          cause,
        });
      }
      data = undefined; // Error status with a non-JSON body (e.g. a proxy page): still an HTTP error.
    }

    if (!response.ok) {
      const apiError = parseApiErrorEnvelope(data);
      throw new ApiRequestError({
        kind: 'http',
        message: apiError?.message ?? `Request failed with status ${response.status}`,
        status: response.status,
        apiError,
      });
    }

    if (!parse) return data;
    try {
      return parse(data);
    } catch (cause) {
      throw new ApiRequestError({
        kind: 'invalid_response',
        message: 'The server returned an unexpected payload',
        status: response.status,
        cause,
      });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function toTransportError(
  cause: unknown,
  context: { timedOut: boolean; callerAborted: boolean },
): unknown {
  if (context.timedOut) {
    return new ApiRequestError({ kind: 'timeout', message: 'The request timed out', cause });
  }
  if (context.callerAborted) {
    return cause; // Deliberate cancellation by the caller: let the native AbortError through.
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new ApiRequestError({ kind: 'offline', message: 'The device is offline', cause });
  }
  return new ApiRequestError({
    kind: 'network',
    message: 'The server could not be reached',
    cause,
  });
}
