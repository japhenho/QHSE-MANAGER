import {
  type AuthSessionResponse,
  type CurrentUserResponse,
  isPermissionKey,
  type LoginRequest,
  type PermissionKey,
} from '@qhse/shared';
import { useSyncExternalStore } from 'react';
import { apiFetch, registerAuthBridge } from '../api';

/**
 * Session of the signed-in user.
 *
 * The access token lives in this module's memory only — never in localStorage nor
 * sessionStorage, where any injected script could read it. The refresh token is an
 * HttpOnly cookie the page cannot read at all. After a reload the session is restored
 * by one silent call to the refresh endpoint.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; identity: CurrentUserResponse };

let state: AuthState = { status: 'loading' };
let accessToken: string | undefined;
const listeners = new Set<() => void>();

function setState(next: AuthState, token: string | undefined): void {
  state = next;
  accessToken = token;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuthState(): AuthState {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getAuthState);
}

/**
 * Returns a function telling whether the signed-in user holds a permission. Use it to
 * hide what the user cannot do; never as a security control — the server checks.
 */
export function usePermissions(): (permission: PermissionKey) => boolean {
  const auth = useAuth();
  const held = auth.status === 'authenticated' ? auth.identity.permissions : [];
  return (permission) => held.includes(permission);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSession(data: unknown): AuthSessionResponse {
  if (!isRecord(data) || typeof data['accessToken'] !== 'string') throw new TypeError('session');
  const { user, tenant } = data;
  if (!isRecord(user) || typeof user['id'] !== 'string' || typeof user['email'] !== 'string') {
    throw new TypeError('session.user');
  }
  if (
    !isRecord(tenant) ||
    typeof tenant['id'] !== 'string' ||
    typeof tenant['slug'] !== 'string' ||
    typeof tenant['name'] !== 'string'
  ) {
    throw new TypeError('session.tenant');
  }
  // Unknown keys (a newer server) are ignored rather than trusted.
  const permissions = Array.isArray(data['permissions'])
    ? data['permissions'].filter(isPermissionKey)
    : [];
  return { ...(data as unknown as AuthSessionResponse), permissions };
}

function accept(session: AuthSessionResponse): string {
  setState(
    {
      status: 'authenticated',
      identity: { user: session.user, tenant: session.tenant, permissions: session.permissions },
    },
    session.accessToken,
  );
  return session.accessToken;
}

const SESSION_CALL = { method: 'POST', withCredentials: true, authenticated: false } as const;

let renewal: Promise<string | undefined> | undefined;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one
 * request: the refresh token is single-use, two parallel exchanges would compete.
 * Resolves to undefined — and the state becomes anonymous — when there is no valid
 * session. A network failure rejects and leaves the state untouched.
 */
export function renewSession(): Promise<string | undefined> {
  renewal ??= apiFetch('/auth/refresh', { ...SESSION_CALL, parse: parseSession })
    .then(accept)
    .catch((error: unknown) => {
      if ((error as { status?: number }).status === 401) {
        setState({ status: 'anonymous' }, undefined);
        return undefined;
      }
      throw error;
    })
    .finally(() => {
      renewal = undefined;
    });
  return renewal;
}

/**
 * Called once at start-up. Any failure (no session, server unreachable) leads to the
 * login screen: the app never stays stuck on a loading state.
 */
export async function restoreSession(): Promise<void> {
  if (state.status !== 'loading') return;
  try {
    await renewSession();
  } catch {
    setState({ status: 'anonymous' }, undefined);
  }
}

export async function signIn(credentials: LoginRequest): Promise<void> {
  const session = await apiFetch('/auth/login', {
    ...SESSION_CALL,
    body: credentials,
    parse: parseSession,
  });
  accept(session);
}

/** Always ends the local session, even if the server cannot be reached. */
export async function signOut(): Promise<void> {
  try {
    await apiFetch('/auth/logout', SESSION_CALL);
  } catch {
    // The cookie may survive offline; the server session then ends by inactivity.
  } finally {
    setState({ status: 'anonymous' }, undefined);
  }
}

/** Test helper: puts the store in a given state without calling the API. */
export function setAuthStateForTests(next: AuthState, token?: string): void {
  setState(next, token);
}

registerAuthBridge({
  getAccessToken: () => accessToken,
  // A failed renewal (network) is reported as "no token": the original 401 surfaces.
  renewSession: () => renewSession().catch(() => undefined),
});
