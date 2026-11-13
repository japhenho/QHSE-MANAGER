import type pg from 'pg';
import request, { type Response } from 'supertest';
import { hashPassword } from '../../src/auth/password.service.js';
import { Clock } from '../../src/common/clock.js';
import { createUser } from '../../src/tenancy/provisioning/create-user.js';
import { createTenant } from '../../src/tenancy/provisioning/create-tenant.js';
import type { TestApp } from '../create-test-app.js';

/** A clock tests can move forward. Starts at the real time (database defaults use it). */
export class FakeClock extends Clock {
  private offsetMs = 0;
  override now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }
}

export interface Account {
  organization: string;
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

/** Creates a tenant and one user able to log in (demo data, never real credentials). */
export async function seedAccount(owner: pg.Client, organization: string): Promise<Account> {
  const tenant = await createTenant(owner, { slug: organization, name: `${organization} (DEMO)` });
  const email = `admin@${organization}.example.test`;
  const password = `demo-password-${organization}`;
  const user = await createUser(owner, { organization, email, password }, hashPassword);
  return { organization, tenantId: tenant.id, userId: user.id, email, password };
}

export const REFRESH_COOKIE = 'qhse_refresh';

/** Extracts the refresh cookie (`name=value`) and its attributes from a response. */
export function refreshCookieOf(
  response: Response,
): { pair: string; value: string; attributes: string } | undefined {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const cookies = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = cookies.find((item) => item.startsWith(`${REFRESH_COOKIE}=`));
  if (!cookie) return undefined;
  const [pair = '', ...attributes] = cookie.split('; ');
  return { pair, value: pair.slice(REFRESH_COOKIE.length + 1), attributes: attributes.join('; ') };
}

export function login(app: TestApp, account: Pick<Account, 'organization' | 'email' | 'password'>) {
  return request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ organization: account.organization, email: account.email, password: account.password });
}

export function refresh(app: TestApp, cookiePair: string) {
  return request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookiePair);
}

export function me(app: TestApp, accessToken: string) {
  return request(app.getHttpServer())
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${accessToken}`);
}

/** Logs in and returns what a client holds afterwards. */
export async function openSession(app: TestApp, account: Account) {
  const response = await login(app, account).expect(200);
  const cookie = refreshCookieOf(response);
  if (!cookie) throw new Error('No refresh cookie in the login response');
  return {
    accessToken: response.body.accessToken as string,
    cookie: cookie.pair,
    cookieValue: cookie.value,
  };
}
