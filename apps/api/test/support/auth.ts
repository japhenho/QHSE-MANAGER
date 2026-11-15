import type { PermissionKey } from '@qhse/shared';
import type pg from 'pg';
import request, { type Response } from 'supertest';
import { hashPassword } from '../../src/auth/password.service.js';
import { Clock } from '../../src/common/clock.js';
import { createUser } from '../../src/tenancy/provisioning/create-user.js';
import { createTenant } from '../../src/tenancy/provisioning/create-tenant.js';
import { uuidv7 } from '../../src/tenancy/uuid.js';
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
export async function seedAccount(
  owner: pg.Client,
  organization: string,
  options: { administrator?: boolean } = {},
): Promise<Account> {
  const tenant = await createTenant(owner, { slug: organization, name: `${organization} (DEMO)` });
  return addUser(owner, { organization, tenantId: tenant.id }, 'admin', options);
}

/** Adds a user to an existing tenant. Without options the user has no role at all. */
export async function addUser(
  owner: pg.Client,
  tenant: Pick<Account, 'organization' | 'tenantId'>,
  localPart: string,
  options: {
    administrator?: boolean;
    permissions?: readonly PermissionKey[];
    /** Where the permissions apply; the whole tenant when absent. */
    scope?: TestScope;
  } = {},
): Promise<Account> {
  const email = `${localPart}@${tenant.organization}.example.test`;
  const password = `demo-password-${tenant.organization}`;
  const user = await createUser(
    owner,
    {
      organization: tenant.organization,
      email,
      password,
      administrator: options.administrator ?? false,
    },
    hashPassword,
  );
  const account = { ...tenant, userId: user.id, email, password };
  if (options.permissions) {
    await grantPermissions(owner, account, options.permissions, options.scope);
  }
  return account;
}

/** A company, a site or a department a role is limited to. */
export interface TestScope {
  type: 'company' | 'site' | 'department';
  id: string;
}

/**
 * Gives a user exactly these permissions, through a dedicated role, for the whole tenant
 * or on one scope. Call it several times to cumulate scopes. Returns the role id.
 */
export async function grantPermissions(
  owner: pg.Client,
  account: Pick<Account, 'tenantId' | 'userId'>,
  permissions: readonly PermissionKey[],
  scope?: TestScope,
): Promise<string> {
  const roleId = uuidv7();
  await owner.query('BEGIN');
  try {
    await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [account.tenantId]);
    await owner.query('INSERT INTO roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
      roleId,
      account.tenantId,
      `test-role-${roleId.slice(-8)}`,
    ]);
    for (const permission of permissions) {
      await owner.query(
        'INSERT INTO role_permissions (tenant_id, role_id, permission) VALUES ($1, $2, $3)',
        [account.tenantId, roleId, permission],
      );
    }
    await owner.query(
      `INSERT INTO role_assignments
         (id, tenant_id, user_id, role_id, scope_type, scope_key, company_id, site_id, department_id)
       VALUES ($1, $2, $3, $4, $5::access_scope_type, $6, $7, $8, $9)`,
      [
        uuidv7(),
        account.tenantId,
        account.userId,
        roleId,
        scope ? scope.type.toUpperCase() : 'TENANT',
        scope?.id ?? 'tenant',
        scope?.type === 'company' ? scope.id : null,
        scope?.type === 'site' ? scope.id : null,
        scope?.type === 'department' ? scope.id : null,
      ],
    );
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
  return roleId;
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
