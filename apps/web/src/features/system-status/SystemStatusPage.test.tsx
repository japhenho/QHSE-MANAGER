import { ERROR_CODES } from '@qhse/shared';
import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../i18n/locales';
import { jsonResponse, renderApp } from '../../test/render-app';

const fr = translations.fr;
const LIVE_URL = 'http://api.test/api/v1/health/live';
const READY_URL = 'http://api.test/api/v1/health/ready';

type Responder = () => Promise<Response>;

/** Routes the two health URLs to scripted outcomes; any other request fails the test. */
function stubHealth(responders: { live: Responder; ready: Responder }) {
  const mock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === LIVE_URL) return responders.live();
    if (url === READY_URL) return responders.ready();
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const ok: Responder = async () => jsonResponse({ status: 'ok' });
const networkFailure: Responder = async () => {
  throw new TypeError('Failed to fetch');
};

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function findProbe(probe: 'live' | 'ready', state: string) {
  const row = await screen.findByTestId(`probe-${probe}`);
  await waitFor(() => expect(row).toHaveAttribute('data-state', state));
  return row;
}

describe('system status page', () => {
  it('shows a loading state while the checks are running, then success', async () => {
    const live = deferred();
    const ready = deferred();
    const fetchMock = stubHealth({ live: () => live.promise, ready: () => ready.promise });
    renderApp('/system-status');

    const liveRow = await findProbe('live', 'checking');
    expect(within(liveRow).getByText(fr.systemStatus.state.checking)).toBeInTheDocument();
    expect(screen.getByTestId('overall-status')).toHaveTextContent(
      fr.systemStatus.summary.checking,
    );
    expect(screen.getByRole('button', { name: fr.systemStatus.checking })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    live.resolve(jsonResponse({ status: 'ok' }));
    ready.resolve(jsonResponse({ status: 'ok' }));

    expect(within(await findProbe('live', 'ok')).getByText(fr.systemStatus.state.ok)).toBeVisible();
    expect(
      within(await findProbe('ready', 'ok')).getByText(fr.systemStatus.state.ok),
    ).toBeVisible();
    expect(screen.getByTestId('overall-status')).toHaveTextContent(fr.systemStatus.summary.ok);
    expect(screen.getByText('http://api.test/api/v1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('degrades gracefully when the API is down, and recovers with the retry button', async () => {
    const responders = { live: networkFailure, ready: networkFailure };
    const fetchMock = stubHealth({
      live: () => responders.live(),
      ready: () => responders.ready(),
    });
    const { user } = renderApp('/system-status');

    const liveRow = await findProbe('live', 'unreachable');
    const readyRow = await findProbe('ready', 'unreachable');
    expect(within(liveRow).getByText(fr.systemStatus.state.unreachable)).toBeInTheDocument();
    expect(within(liveRow).getByText(fr.errors.network)).toBeInTheDocument();
    expect(within(readyRow).getByText(fr.errors.network)).toBeInTheDocument();
    expect(screen.getByTestId('overall-status')).toHaveTextContent(fr.systemStatus.summary.down);
    // No automatic retry storm: one request per probe.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The shell is still usable.
    expect(screen.getByRole('navigation', { name: fr.nav.label })).toBeInTheDocument();

    responders.live = ok;
    responders.ready = ok;
    await user.click(screen.getByRole('button', { name: fr.systemStatus.refresh }));

    await findProbe('live', 'ok');
    await findProbe('ready', 'ok');
    expect(screen.getByTestId('overall-status')).toHaveTextContent(fr.systemStatus.summary.ok);
    expect(screen.queryByText(fr.errors.network)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reports "not ready" when the readiness probe answers 503', async () => {
    stubHealth({
      live: ok,
      ready: async () =>
        jsonResponse(
          {
            code: ERROR_CODES.SERVICE_UNAVAILABLE,
            message: 'Service indisponible',
            requestId: 'req-503',
          },
          503,
        ),
    });
    renderApp('/system-status');

    await findProbe('live', 'ok');
    const readyRow = await findProbe('ready', 'notReady');
    expect(within(readyRow).getByText(fr.systemStatus.state.notReady)).toBeInTheDocument();
    expect(within(readyRow).getByText(fr.systemStatus.notReadyDetail)).toBeInTheDocument();
    expect(within(readyRow).getByText(/req-503/)).toBeInTheDocument();
    expect(screen.getByTestId('overall-status')).toHaveTextContent(
      fr.systemStatus.summary.degraded,
    );
  });

  it('shows the server message of an ApiError envelope on an unexpected error status', async () => {
    stubHealth({
      live: async () =>
        jsonResponse({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Erreur interne' }, 500),
      ready: ok,
    });
    renderApp('/system-status');

    const liveRow = await findProbe('live', 'error');
    expect(within(liveRow).getByText(fr.systemStatus.state.error)).toBeInTheDocument();
    expect(within(liveRow).getByText('Erreur interne')).toBeInTheDocument();
  });

  it('reports a timeout as unreachable with a specific explanation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Never answers; only settles when the request is aborted, like the real fetch.
    const mock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', mock);
    renderApp('/system-status');

    await findProbe('live', 'checking');
    await vi.advanceTimersByTimeAsync(8_000);

    const liveRow = await findProbe('live', 'unreachable');
    expect(within(liveRow).getByText(fr.errors.timeout)).toBeInTheDocument();
  });

  it('shows the offline state when the device has no connectivity', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    stubHealth({ live: networkFailure, ready: networkFailure });
    renderApp('/system-status');

    const liveRow = await findProbe('live', 'offline');
    expect(within(liveRow).getByText(fr.systemStatus.state.offline)).toBeInTheDocument();
    expect(within(liveRow).getByText(fr.errors.offline)).toBeInTheDocument();
    expect(screen.getByTestId('overall-status')).toHaveTextContent(fr.systemStatus.summary.offline);
    // Global indicator in the top bar.
    expect(within(screen.getByRole('banner')).getByText(fr.app.offline)).toBeInTheDocument();
  });

  it('does not send requests while offline and checks as soon as the connection is back', async () => {
    onlineManager.setOnline(false);
    const fetchMock = stubHealth({ live: ok, ready: ok });
    renderApp('/system-status');

    await findProbe('live', 'offline');
    await findProbe('ready', 'offline');
    expect(fetchMock).not.toHaveBeenCalled();

    onlineManager.setOnline(true);

    await findProbe('live', 'ok');
    await findProbe('ready', 'ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
