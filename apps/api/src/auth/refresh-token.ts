import { createHash, randomBytes } from 'node:crypto';
import { isUuid } from '../tenancy/index.js';

export const REFRESH_COOKIE_NAME = 'qhse_refresh';
/** The cookie is only ever sent to the authentication routes. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 256 random bits, URL-safe. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored: a database leak does not yield usable tokens. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Cookie value: `<tenant id>.<token>`. The tenant id only says where to look the token
 * up (rows are isolated per tenant); it proves nothing by itself.
 */
export function formatRefreshCookie(tenantId: string, token: string): string {
  return `${tenantId}.${token}`;
}

export function parseRefreshCookie(
  value: string | undefined,
): { tenantId: string; token: string } | null {
  if (!value) return null;
  const separator = value.indexOf('.');
  if (separator < 0) return null;
  const tenantId = value.slice(0, separator);
  const token = value.slice(separator + 1);
  if (!isUuid(tenantId) || !TOKEN_PATTERN.test(token)) return null;
  return { tenantId, token };
}

/** Minimal Cookie header parser (first occurrence wins, values are not decoded). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
