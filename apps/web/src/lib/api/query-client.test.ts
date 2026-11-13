import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './errors';
import { MAX_QUERY_RETRIES, createQueryClient, retryDelay, shouldRetryQuery } from './query-client';

const error = (kind: ApiRequestError['kind'], status?: number) =>
  new ApiRequestError({ kind, message: kind, status });

describe('query retry policy', () => {
  it('retries transient failures a limited number of times', () => {
    expect(shouldRetryQuery(0, error('network'))).toBe(true);
    expect(shouldRetryQuery(0, error('timeout'))).toBe(true);
    expect(shouldRetryQuery(0, error('http', 503))).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, error('network'))).toBe(false);
  });

  it('never retries client errors, offline failures or unknown errors', () => {
    expect(shouldRetryQuery(0, error('http', 404))).toBe(false);
    expect(shouldRetryQuery(0, error('http', 401))).toBe(false);
    expect(shouldRetryQuery(0, error('offline'))).toBe(false);
    expect(shouldRetryQuery(0, new Error('bug'))).toBe(false);
  });

  it('backs off exponentially up to a cap', () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it('does not refetch on window focus and never retries mutations', () => {
    const { queries, mutations } = createQueryClient().getDefaultOptions();
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(mutations?.retry).toBe(false);
  });
});
