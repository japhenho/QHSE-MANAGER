import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch, isApiRequestError } from '../../lib/api';

/** A diagnostic must answer quickly: shorter timeout than regular requests, no automatic retry. */
const HEALTH_TIMEOUT_MS = 8_000;

export type HealthProbe = 'live' | 'ready';

export const healthQueryKey = (probe: HealthProbe) => ['health', probe] as const;

/**
 * Calls `GET /health/<probe>`. Only the HTTP outcome matters (2xx = healthy); the body is
 * deliberately ignored so this page does not depend on the exact payload of the API.
 */
async function fetchHealth(probe: HealthProbe, signal: AbortSignal): Promise<true> {
  await apiFetch(`/health/${probe}`, { signal, timeoutMs: HEALTH_TIMEOUT_MS });
  return true;
}

export function useHealthProbe(probe: HealthProbe): UseQueryResult<true> {
  return useQuery({
    queryKey: healthQueryKey(probe),
    queryFn: ({ signal }) => fetchHealth(probe, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

export type ProbeState = 'checking' | 'ok' | 'notReady' | 'unreachable' | 'offline' | 'error';

/** Maps a probe query (plus the device connectivity) to what the user should be told. */
export function getProbeState(
  probe: HealthProbe,
  query: Pick<UseQueryResult<true>, 'fetchStatus' | 'status' | 'error'>,
  online: boolean,
): ProbeState {
  if (query.fetchStatus === 'fetching') return 'checking';
  // Paused = TanStack Query is waiting for connectivity before sending the request.
  if (!online || query.fetchStatus === 'paused') return 'offline';
  if (query.status === 'success') return 'ok';
  if (query.status === 'pending') return 'checking';

  const { error } = query;
  if (!isApiRequestError(error)) return 'error';
  switch (error.kind) {
    case 'offline':
      return 'offline';
    case 'network':
    case 'timeout':
      return 'unreachable';
    case 'http':
      // By contract `/health/ready` answers 503 while a dependency is down.
      return probe === 'ready' && error.status === 503 ? 'notReady' : 'error';
    case 'invalid_response':
      return 'error';
  }
}

export type OverallState = 'checking' | 'ok' | 'degraded' | 'down' | 'offline';

export function getOverallState(live: ProbeState, ready: ProbeState): OverallState {
  if (live === 'offline' || ready === 'offline') return 'offline';
  if (live === 'checking' || ready === 'checking') return 'checking';
  if (live === 'ok' && ready === 'ok') return 'ok';
  // "Down" only when no probe obtained any answer; any HTTP response proves the API is reachable.
  if (live === 'unreachable' && ready === 'unreachable') return 'down';
  return 'degraded';
}
