import { PERMISSION_KEYS, type PermissionKey } from '@qhse/shared';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router-dom';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createQueryClient } from '../lib/api';
import { type AuthState, setAuthStateForTests } from '../lib/auth';

/** Demo identity used by tests that need a signed-in user. */
export const TEST_IDENTITY = {
  user: { id: '0193a000-0000-7000-8000-000000000001', email: 'demo.user@example.test' },
  tenant: { id: '0193a000-0000-7000-8000-0000000000aa', slug: 'demo-org', name: 'Demo Org (DEMO)' },
  permissions: [...PERMISSION_KEYS],
};

/** Same identity with a restricted set of permissions. */
export function identityWith(permissions: PermissionKey[]) {
  return { ...TEST_IDENTITY, permissions };
}

/**
 * Renders the real application (shell, routes, providers) at the given URL.
 * Signed in by default; pass `auth` to start anonymous or still loading.
 */
export function renderApp(
  initialPath = '/',
  auth: AuthState = { status: 'authenticated', identity: TEST_IDENTITY },
) {
  setAuthStateForTests(auth, auth.status === 'authenticated' ? 'test-access-token' : undefined);
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const queryClient = createQueryClient();
  const user = userEvent.setup();
  return { user, router, ...render(<App router={router} queryClient={queryClient} />) };
}

/** Builds a JSON `Response` like the API would send. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
