import { QueryClient } from '@tanstack/react-query';
import { isApiRequestError } from './errors';

export const MAX_QUERY_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 8_000;

/** Retries only failures that can heal on their own (network drop, timeout, 5xx, 429). */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return isApiRequestError(error) && error.isTransient;
}

/** Exponential backoff: 1s, 2s, 4s… capped. */
export function retryDelay(attemptIndex: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attemptIndex, RETRY_MAX_DELAY_MS);
}

/**
 * Query defaults tuned for weak, intermittent or metered connectivity:
 * few retries with backoff, no refetch on every focus/mount, queries paused while offline
 * and resumed once on reconnect. Mutations are never retried automatically because
 * they may not be idempotent.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'online',
        retry: shouldRetryQuery,
        retryDelay,
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
      },
      mutations: {
        networkMode: 'online',
        retry: false,
      },
    },
  });
}
