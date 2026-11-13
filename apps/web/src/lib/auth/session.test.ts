import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, TEST_IDENTITY } from '../../test/render-app';
import { apiFetch } from '../api';
import { getAuthState, renewSession, setAuthStateForTests } from './session';

const session = (accessToken: string) => ({ accessToken, expiresIn: 900, ...TEST_IDENTITY });
const unauthorized = () =>
  jsonResponse({ code: 'UNAUTHENTICATED', message: 'Authentication required' }, 401);

function authorizationOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.['Authorization'];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API calls with a session', () => {
  it('send the access token as a bearer', async () => {
    setAuthStateForTests({ status: 'authenticated', identity: TEST_IDENTITY }, 'token-1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/anything');

    expect(authorizationOf(fetchMock.mock.calls[0]?.[1] as RequestInit)).toBe('Bearer token-1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBeUndefined();
  });

  it('renew the session once on a 401 and replay the request with the new token', async () => {
    setAuthStateForTests({ status: 'authenticated', identity: TEST_IDENTITY }, 'expired');
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        seen.push(`${path} ${authorizationOf(init) ?? '-'}`);
        if (path.endsWith('/auth/refresh')) return jsonResponse(session('fresh'));
        return authorizationOf(init) === 'Bearer fresh'
          ? jsonResponse({ ok: true })
          : unauthorized();
      }),
    );

    await expect(apiFetch('/data')).resolves.toEqual({ ok: true });

    expect(seen).toEqual([
      '/api/v1/data Bearer expired',
      '/api/v1/auth/refresh -',
      '/api/v1/data Bearer fresh',
    ]);
  });

  it('share a single renewal between concurrent requests (the refresh token is single-use)', async () => {
    setAuthStateForTests({ status: 'authenticated', identity: TEST_IDENTITY }, 'expired');
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/auth/refresh')) {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return jsonResponse(session('fresh'));
        }
        return authorizationOf(init) === 'Bearer fresh'
          ? jsonResponse({ ok: true })
          : unauthorized();
      }),
    );

    await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')]);

    expect(refreshCalls).toBe(1);
  });

  it('become anonymous when the session cannot be renewed, and surface the 401', async () => {
    setAuthStateForTests({ status: 'authenticated', identity: TEST_IDENTITY }, 'expired');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorized()),
    );

    await expect(apiFetch('/data')).rejects.toMatchObject({ status: 401 });

    expect(getAuthState()).toEqual({ status: 'anonymous' });
  });

  it('keep the session when the renewal fails for a network reason', async () => {
    setAuthStateForTests({ status: 'authenticated', identity: TEST_IDENTITY }, 'expired');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
        return unauthorized();
      }),
    );

    await expect(apiFetch('/data')).rejects.toMatchObject({ status: 401 });
    expect(getAuthState().status).toBe('authenticated');
    await expect(renewSession()).rejects.toMatchObject({ kind: 'network' });
  });

  it('never send the token on calls marked as unauthenticated', async () => {
    setAuthStateForTests({ status: 'authenticated', identity: TEST_IDENTITY }, 'token-1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health/live', { authenticated: false });

    expect(authorizationOf(fetchMock.mock.calls[0]?.[1] as RequestInit)).toBeUndefined();
  });
});
