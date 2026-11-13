export const API_BASE_URL_VARIABLE = 'VITE_API_BASE_URL';

/** Raised when the build-time configuration of the web app is unusable. */
export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, reason: string) {
    super(`Invalid configuration: ${variable} ${reason}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

/**
 * Validates and normalises the API base URL.
 * Accepts an absolute http(s) URL (`http://localhost:3000/api/v1`) or a same-origin
 * absolute path (`/api/v1`, typical behind an on-premise reverse proxy).
 * The returned value never ends with a slash.
 */
export function parseApiBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ConfigError(API_BASE_URL_VARIABLE, 'is not set');
  }
  const value = raw.trim().replace(/\/+$/, '');

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(API_BASE_URL_VARIABLE, 'is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(API_BASE_URL_VARIABLE, 'must use http or https');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new ConfigError(API_BASE_URL_VARIABLE, 'must not contain a query string or a fragment');
  }
  return value;
}

let cachedBaseUrl: string | undefined;

/**
 * API base URL from the environment. Throws a `ConfigError` when it is missing or invalid;
 * `main.tsx` calls this once at startup so a misconfigured build fails visibly.
 */
export function getApiBaseUrl(): string {
  cachedBaseUrl ??= parseApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
  return cachedBaseUrl;
}
