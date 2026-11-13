import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../i18n/locales';
import { getAuthState } from '../../lib/auth';
import { jsonResponse, renderApp, TEST_IDENTITY } from '../../test/render-app';

const fr = translations.fr;
const en = translations.en;

const SESSION = { accessToken: 'header.payload.signature', expiresIn: 900, ...TEST_IDENTITY };
const unauthenticated = () =>
  jsonResponse(
    { code: 'UNAUTHENTICATED', message: 'Invalid credentials', requestId: 'req-1' },
    401,
  );

type Handler = (init: RequestInit) => Response | Promise<Response>;

/** Routes fetch calls by API path; any unexpected call fails the test. */
function stubApi(handlers: Record<string, Handler>) {
  const calls: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname.replace('/api/v1', '');
      calls.push({ path, init });
      const handler = handlers[path];
      if (!handler) throw new Error(`Unexpected API call: ${path}`);
      return handler(init);
    }),
  );
  return calls;
}

async function fillAndSubmit(user: ReturnType<typeof renderApp>['user'], labels = fr.auth) {
  await user.type(await screen.findByLabelText(labels.organization), 'Demo-Org');
  await user.type(screen.getByLabelText(labels.email), 'Demo.User@example.test');
  await user.type(screen.getByLabelText(labels.password), 'a demo password');
  await user.click(screen.getByRole('button', { name: labels.submit }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login screen', () => {
  it('sends anonymous visitors of any page to the login screen', async () => {
    renderApp('/system-status', { status: 'anonymous' });
    expect(
      await screen.findByRole('heading', { level: 1, name: fr.auth.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: fr.nav.label })).not.toBeInTheDocument();
  });

  it('signs in, keeps the token out of browser storage, and returns to the requested page', async () => {
    const calls = stubApi({
      '/auth/login': () => jsonResponse(SESSION),
      '/health/live': () => jsonResponse({ status: 'ok' }),
      '/health/ready': () => jsonResponse({ status: 'ok' }),
    });
    const { user } = renderApp('/system-status', { status: 'anonymous' });

    await fillAndSubmit(user);

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.systemStatus.title }),
    ).toBeInTheDocument();
    expect(getAuthState()).toEqual({ status: 'authenticated', identity: TEST_IDENTITY });

    const loginCall = calls.find((call) => call.path === '/auth/login');
    expect(loginCall?.init.credentials).toBe('include');
    expect(JSON.parse(String(loginCall?.init.body))).toEqual({
      organization: 'demo-org',
      email: 'demo.user@example.test',
      password: 'a demo password',
    });

    const stored =
      JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(stored).not.toContain(SESSION.accessToken);
    expect(stored).not.toContain('a demo password');
    // Only the organisation code is remembered, as a convenience.
    expect(window.localStorage.getItem('qhse.organization')).toBe('demo-org');
  });

  it('shows one generic message for refused credentials and clears the password', async () => {
    stubApi({ '/auth/login': unauthenticated });
    const { user } = renderApp('/login', { status: 'anonymous' });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.errors.invalidCredentials);
    expect(screen.getByLabelText(fr.auth.password)).toHaveValue('');
    expect(screen.getByLabelText(fr.auth.email)).toHaveValue('Demo.User@example.test');
    expect(getAuthState().status).toBe('anonymous');
  });

  it('tells how long to wait when there were too many attempts', async () => {
    stubApi({
      '/auth/login': () =>
        jsonResponse(
          {
            code: 'RATE_LIMITED',
            message: 'Too many attempts',
            details: { retryAfterSeconds: 240 },
          },
          429,
        ),
    });
    const { user } = renderApp('/login', { status: 'anonymous' });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.auth.errors.tooManyAttempts_other.replace('{{count}}', '4'),
    );
  });

  it('explains a network failure instead of blaming the credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { user } = renderApp('/login', { status: 'anonymous' });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network);
  });

  it('validates the fields before calling the API', async () => {
    const calls = stubApi({});
    const { user } = renderApp('/login', { status: 'anonymous' });

    await user.type(await screen.findByLabelText(fr.auth.email), 'not-an-email');
    await user.click(screen.getByRole('button', { name: fr.auth.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.errors.invalidForm);
    expect(screen.getByText(fr.auth.fieldErrors.organization)).toBeInTheDocument();
    expect(screen.getByText(fr.auth.fieldErrors.email)).toBeInTheDocument();
    expect(screen.getByText(fr.auth.fieldErrors.password)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.auth.email)).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toEqual([]);
  });

  it('shows a busy state while the request is in flight', async () => {
    let resolve: (response: Response) => void = () => undefined;
    stubApi({ '/auth/login': () => new Promise<Response>((r) => (resolve = r)) });
    const { user } = renderApp('/login', { status: 'anonymous' });

    await fillAndSubmit(user);

    const button = await screen.findByRole('button', { name: fr.auth.submitting });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(fr.auth.password)).toBeDisabled();
    resolve(unauthenticated());
    await screen.findByRole('alert');
  });

  it('is available in English', async () => {
    const { user } = renderApp('/login', { status: 'anonymous' });
    await user.click(await screen.findByRole('button', { name: 'English' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: en.auth.title }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.organization)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.auth.submit })).toBeInTheDocument();
  });

  it('a signed-in user opening /login is sent to the home page', async () => {
    renderApp('/login');
    expect(
      await screen.findByRole('heading', { level: 1, name: fr.home.title }),
    ).toBeInTheDocument();
  });
});

describe('session', () => {
  it('is restored silently at start-up from the refresh cookie', async () => {
    const calls = stubApi({ '/auth/refresh': () => jsonResponse(SESSION) });
    renderApp('/', { status: 'loading' });

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.home.title }),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.path === '/auth/refresh')).toHaveLength(1);
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('falls back to the login screen when there is no session or the API is unreachable', async () => {
    stubApi({ '/auth/refresh': unauthenticated });
    const first = renderApp('/', { status: 'loading' });
    expect(
      await screen.findByRole('heading', { level: 1, name: fr.auth.title }),
    ).toBeInTheDocument();
    first.unmount();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderApp('/', { status: 'loading' });
    expect(
      await screen.findByRole('heading', { level: 1, name: fr.auth.title }),
    ).toBeInTheDocument();
  });

  it('shows who is signed in and signs out', async () => {
    const calls = stubApi({ '/auth/logout': () => new Response(null, { status: 204 }) });
    const { user } = renderApp('/');

    expect(await screen.findByText(TEST_IDENTITY.user.email)).toBeInTheDocument();
    expect(screen.getByText(TEST_IDENTITY.tenant.name)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: fr.auth.signOut }));

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.auth.title }),
    ).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual(['/auth/logout']);
    await waitFor(() => expect(getAuthState().status).toBe('anonymous'));
  });

  it('signs out locally even when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: fr.auth.signOut }));

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.auth.title }),
    ).toBeInTheDocument();
  });
});
