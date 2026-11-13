import { ERROR_CODES } from '@qhse/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../test/render-app';
import { apiFetch } from './client';
import { ApiRequestError } from './errors';

const BASE_URL = 'http://api.test/api/v1';

function stubFetch(implementation: typeof fetch) {
  const mock = vi.fn(implementation);
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** A fetch that never answers and only settles when its signal is aborted, like the real one. */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('apiFetch', () => {
  it('requests the path under the configured base URL and returns the JSON body', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ status: 'ok' }));

    const data = await apiFetch('/health/live');

    expect(data).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/health/live`);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ Accept: 'application/json', 'Accept-Language': 'fr' });
    expect(init?.body).toBeUndefined();
  });

  it('serialises a JSON body and sets the content type', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ id: 1 }, 201));

    await apiFetch('/things', { method: 'POST', body: { name: 'valve' } });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"name":"valve"}');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('returns undefined for an empty 204 response', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(apiFetch('/things/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('runs the parse function and returns its typed result', async () => {
    stubFetch(async () => jsonResponse({ count: 3 }));
    const parse = (data: unknown): number => {
      if (typeof data === 'object' && data !== null && 'count' in data) {
        const { count } = data;
        if (typeof count === 'number') return count;
      }
      throw new Error('bad payload');
    };

    await expect(apiFetch('/count', { parse })).resolves.toBe(3);
  });

  it('rejects with kind "invalid_response" when parse rejects the payload', async () => {
    stubFetch(async () => jsonResponse({ unexpected: true }));
    const error = await catchError(
      apiFetch('/count', {
        parse: () => {
          throw new Error('bad payload');
        },
      }),
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ kind: 'invalid_response', status: 200 });
  });

  it('rejects with kind "invalid_response" when a success body is not JSON', async () => {
    stubFetch(async () => new Response('<html>proxy</html>', { status: 200 }));
    const error = await catchError(apiFetch('/health/live'));
    expect(error).toMatchObject({ kind: 'invalid_response', status: 200 });
  });

  it('parses the ApiError envelope of an error response', async () => {
    stubFetch(async () =>
      jsonResponse(
        {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Ressource introuvable',
          details: { id: '42' },
          requestId: 'req-123',
        },
        404,
      ),
    );

    const error = await catchError(apiFetch('/things/42'));

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      kind: 'http',
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'req-123',
      message: 'Ressource introuvable',
      isTransient: false,
      apiError: {
        code: 'NOT_FOUND',
        message: 'Ressource introuvable',
        details: { id: '42' },
        requestId: 'req-123',
      },
    });
  });

  it('still reports an HTTP error when the error body is not the envelope', async () => {
    stubFetch(async () => new Response('Bad Gateway', { status: 502 }));

    const error = await catchError(apiFetch('/health/live'));

    expect(error).toMatchObject({ kind: 'http', status: 502, isTransient: true });
    expect((error as ApiRequestError).apiError).toBeUndefined();
  });

  it('does not accept an envelope with an unknown error code', async () => {
    stubFetch(async () => jsonResponse({ code: 'MADE_UP', message: 'nope' }, 400));
    const error = await catchError(apiFetch('/things'));
    expect(error).toMatchObject({ kind: 'http', status: 400 });
    expect((error as ApiRequestError).apiError).toBeUndefined();
  });

  it('rejects with kind "network" when the server cannot be reached', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await catchError(apiFetch('/health/live'));

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ kind: 'network', isTransient: true });
    expect((error as ApiRequestError).status).toBeUndefined();
  });

  it('rejects with kind "offline" when the device has no connectivity', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await catchError(apiFetch('/health/live'));

    expect(error).toMatchObject({ kind: 'offline', isTransient: false });
  });

  it('aborts the request and rejects with kind "timeout" after timeoutMs', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(hangingFetch());

    const pending = catchError(apiFetch('/health/live', { timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ kind: 'timeout', isTransient: true });
  });

  it('lets the native AbortError through when the caller cancels', async () => {
    stubFetch(hangingFetch());
    const controller = new AbortController();

    const pending = catchError(apiFetch('/health/live', { signal: controller.signal }));
    controller.abort();
    const error = await pending;

    expect(error).not.toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('refuses a path that does not start with a slash', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));
    await expect(apiFetch('health/live')).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
