import { PERMISSIONS } from '@qhse/shared';
import type pg from 'pg';
import request from 'supertest';
import { RateLimiter } from '../src/auth/rate-limiter.service.js';
import { uuidv7 } from '../src/tenancy/index.js';
import { createTestApp, type TestApp } from './create-test-app.js';
import {
  type Account,
  addUser,
  grantPermissions,
  openSession,
  seedAccount,
} from './support/auth.js';
import { createAppClient, createOwnerClient, resetDatabase } from './support/db.js';
import {
  expectInvisibleOutsideScope,
  expectListLimitedToScope,
} from './support/endpoint-contract.js';
import { asTenant, sqlState } from './support/tenants.js';

const SITE = { countryCode: 'CG', timeZone: 'Africa/Brazzaville', currencyCode: 'XAF' };
const ORG = [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.ORGANIZATION_MANAGE] as const;

/**
 * Organisation of tenant A used by every test:
 *
 *   C1 ── S1 ── D1a, D1b
 *      └─ S2 ── D2
 *   C2 ── S3 ── D3
 */
describe('access scopes (lot P1-07)', () => {
  let app: TestApp;
  let owner: pg.Client;
  let adminA: Account;
  let adminB: Account;
  let adminToken: string;
  type Name = 'C1' | 'C2' | 'S1' | 'S2' | 'S3' | 'D1a' | 'D1b' | 'D2' | 'D3';
  const id = {} as Record<Name, string>;

  const api = (token: string) => {
    const agent = request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${token}` };
    return {
      get: (url: string) => agent.get(`/api/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => agent.post(`/api/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => agent.patch(`/api/v1${url}`).set(auth).send(body),
      delete: (url: string) => agent.delete(`/api/v1${url}`).set(auth),
    };
  };

  async function tokenOf(account: Account): Promise<string> {
    app.get(RateLimiter).reset();
    return (await openSession(app, account)).accessToken;
  }

  let userCounter = 0;
  /** A user of tenant A holding `permissions` on each of the given scopes. */
  async function scopedUser(
    permissions: readonly (typeof ORG)[number][] | readonly string[],
    ...scopes: { type: 'company' | 'site' | 'department'; id: string }[]
  ): Promise<{ account: Account; token: string }> {
    userCounter += 1;
    const account = await addUser(owner, adminA, `scoped${String(userCounter)}`);
    for (const scope of scopes) {
      await grantPermissions(owner, account, permissions as never, scope);
    }
    return { account, token: await tokenOf(account) };
  }

  const idsOf = async (token: string, url: string): Promise<string[]> =>
    (await api(token).get(url).expect(200)).body.items
      .map((item: { id: string }) => item.id)
      .sort();

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    await owner.connect();
    adminA = await seedAccount(owner, 'scope-alpha', { administrator: true });
    adminB = await seedAccount(owner, 'scope-bravo', { administrator: true });
    app = await createTestApp();
    adminToken = await tokenOf(adminA);
    const admin = api(adminToken);
    const company = async (code: string) =>
      (await admin.post('/companies', { code, name: `Company ${code}` }).expect(201)).body.id;
    const site = async (companyId: string, code: string) =>
      (await admin.post('/sites', { companyId, code, name: `Site ${code}`, ...SITE }).expect(201))
        .body.id;
    const department = async (siteId: string, name: string) =>
      (await admin.post('/departments', { siteId, name }).expect(201)).body.id;
    id['C1'] = await company('C1');
    id['C2'] = await company('C2');
    id['S1'] = await site(id['C1'], 'S1');
    id['S2'] = await site(id['C1'], 'S2');
    id['S3'] = await site(id['C2'], 'S3');
    id['D1a'] = await department(id['S1'], 'D1a');
    id['D1b'] = await department(id['S1'], 'D1b');
    id['D2'] = await department(id['S2'], 'D2');
    id['D3'] = await department(id['S3'], 'D3');
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  const ids = (...names: Name[]) => names.map((name) => id[name]).sort();

  // ------------------------------------------------------------ site scope

  describe('a role limited to site S1', () => {
    let token: string;
    beforeAll(async () => {
      token = (await scopedUser(ORG, { type: 'site', id: id['S1'] })).token;
    });

    it('lists only S1 and its departments; no company; nothing of S2', async () => {
      await expectListLimitedToScope(app, '/api/v1/departments?status=all', token, {
        visibleIds: ids('D1a', 'D1b'),
        hiddenIds: ids('D2', 'D3'),
      });
      await expectListLimitedToScope(app, '/api/v1/sites?status=all', token, {
        visibleIds: ids('S1'),
        hiddenIds: ids('S2', 'S3'),
      });
      await expectListLimitedToScope(app, '/api/v1/companies?status=all', token, {
        visibleIds: [],
        hiddenIds: ids('C1', 'C2'),
      });
      // Asking explicitly for another site does not widen the scope.
      expect(await idsOf(token, `/departments?siteId=${id['S2']}`)).toEqual([]);
      expect(await idsOf(token, '/departments?search=D2')).toEqual([]);
    });

    it('reads S1 and its departments', async () => {
      await api(token).get(`/sites/${id['S1']}`).expect(200);
      const department = await api(token).get(`/departments/${id['D1a']}`).expect(200);
      expect(department.body).toMatchObject({ siteId: id['S1'], siteName: 'Site S1' });
    });

    it('a department of S2 — same tenant — does not exist for them: read, update, archive, restore', async () => {
      const d2 = id['D2'];
      const unknown = uuidv7();
      for (const [endpoint, unknownUrl] of [
        [{ method: 'get', url: `/api/v1/departments/${d2}` }, `/api/v1/departments/${unknown}`],
        [
          {
            method: 'patch',
            url: `/api/v1/departments/${d2}`,
            body: { name: 'Taken over', version: 1 },
          },
          `/api/v1/departments/${unknown}`,
        ],
        [
          { method: 'post', url: `/api/v1/departments/${d2}/archive` },
          `/api/v1/departments/${unknown}/archive`,
        ],
        [
          { method: 'post', url: `/api/v1/departments/${d2}/restore` },
          `/api/v1/departments/${unknown}/restore`,
        ],
        [{ method: 'get', url: `/api/v1/sites/${id['S2']}` }, `/api/v1/sites/${unknown}`],
        [
          {
            method: 'patch',
            url: `/api/v1/sites/${id['S2']}`,
            body: { name: 'Taken over', version: 1 },
          },
          `/api/v1/sites/${unknown}`,
        ],
        [{ method: 'get', url: `/api/v1/companies/${id['C1']}` }, `/api/v1/companies/${unknown}`],
        [
          {
            method: 'patch',
            url: `/api/v1/companies/${id['C1']}`,
            body: { name: 'Taken over', version: 1 },
          },
          `/api/v1/companies/${unknown}`,
        ],
      ] as const) {
        await expectInvisibleOutsideScope(app, endpoint, unknownUrl, token);
      }
      // Nothing changed.
      const d2After = await api(adminToken).get(`/departments/${d2}`).expect(200);
      expect(d2After.body).toMatchObject({ name: 'D2', version: 1, archivedAt: null });
    });

    it('manages inside the scope: edits S1, creates and archives a department of S1', async () => {
      const site = await api(token).get(`/sites/${id['S1']}`).expect(200);
      await api(token)
        .patch(`/sites/${id['S1']}`, { name: 'Site S1', version: site.body.version })
        .expect(200);
      const created = await api(token)
        .post('/departments', { siteId: id['S1'], name: 'Created in scope' })
        .expect(201);
      await api(token).post(`/departments/${created.body.id}/archive`).expect(200);
    });

    it('cannot create outside the scope: a department in S2 (404), a site in C1 (404), a company (403)', async () => {
      const dept = await api(token)
        .post('/departments', { siteId: id['S2'], name: 'Intruder' })
        .expect(404);
      expect(dept.body).toMatchObject({ code: 'NOT_FOUND' });
      await api(token)
        .post('/sites', { companyId: id['C1'], code: 'INTRUDER', name: 'Intruder', ...SITE })
        .expect(404);
      const company = await api(token)
        .post('/companies', { code: 'INTRUDER', name: 'Intruder' })
        .expect(403);
      expect(company.body).toMatchObject({
        code: 'FORBIDDEN',
        details: { reason: 'outside_scope' },
      });
      expect(await idsOf(adminToken, `/departments?siteId=${id['S2']}`)).toEqual(ids('D2'));
    });

    it('holds the permission nowhere tenant-wide: /auth/me says so, tenant-level screens stay closed', async () => {
      const me = await api(token).get('/auth/me').expect(200);
      expect(me.body.permissions).toEqual([]);
      expect(me.body.permissionsAnywhere).toEqual(['organization:manage', 'organization:read']);
      await api(token).get('/roles').expect(403);
      await api(token).get('/users').expect(403);
      await api(token).get('/audit-events').expect(403);
    });
  });

  // -------------------------------------------------- inheritance and union

  describe('inheritance', () => {
    it('a company scope covers its sites and their departments, and nothing of another company', async () => {
      const { token } = await scopedUser(ORG, { type: 'company', id: id['C1'] });
      expect(await idsOf(token, '/companies')).toEqual(ids('C1'));
      expect(await idsOf(token, '/sites')).toEqual(ids('S1', 'S2'));
      const departments = await idsOf(token, '/departments?status=all');
      expect(departments).toEqual(expect.arrayContaining(ids('D1a', 'D1b', 'D2')));
      expect(departments).not.toContain(id['D3']);
      await api(token).get(`/sites/${id['S3']}`).expect(404);
      await api(token).get(`/departments/${id['D3']}`).expect(404);

      // May create a site in its company, not a company, not a site elsewhere.
      await api(token)
        .post('/sites', { companyId: id['C1'], code: 'C1-NEW', name: 'New in C1', ...SITE })
        .expect(201);
      await api(token)
        .post('/sites', { companyId: id['C2'], code: 'C2-NEW', name: 'New in C2', ...SITE })
        .expect(404);
      await api(token).post('/companies', { code: 'NEW-CO', name: 'New company' }).expect(403);
    });

    it('a tenant scope covers everything', async () => {
      const account = await addUser(owner, adminA, 'tenant-wide', { permissions: ORG });
      const token = await tokenOf(account);
      expect(await idsOf(token, '/companies')).toEqual(ids('C1', 'C2'));
      expect(await idsOf(token, '/sites')).toEqual(expect.arrayContaining(ids('S1', 'S2', 'S3')));
      await api(token).get(`/departments/${id['D3']}`).expect(200);
      await api(token).post('/companies', { code: 'TW-CO', name: 'Tenant wide' }).expect(201);
    });

    it('a department scope covers that department only', async () => {
      const { token } = await scopedUser(ORG, { type: 'department', id: id['D1a'] });
      expect(await idsOf(token, '/departments')).toEqual(ids('D1a'));
      expect(await idsOf(token, '/sites')).toEqual([]);
      await api(token).get(`/departments/${id['D1b']}`).expect(404);
      await api(token).get(`/sites/${id['S1']}`).expect(404);
      await api(token).post('/departments', { siteId: id['S1'], name: 'Sibling' }).expect(404);
    });

    it('a scope never gives access to what contains it', async () => {
      const { token } = await scopedUser(ORG, { type: 'site', id: id['S3'] });
      await api(token).get(`/companies/${id['C2']}`).expect(404);
      await api(token).post(`/companies/${id['C2']}/archive`).expect(404);
    });
  });

  describe('cumulating assignments', () => {
    it('two site scopes give the union, not the intersection', async () => {
      const { token } = await scopedUser(
        ORG,
        { type: 'site', id: id['S1'] },
        { type: 'site', id: id['S3'] },
      );
      expect(await idsOf(token, '/sites')).toEqual(ids('S1', 'S3'));
      const departments = await idsOf(token, '/departments?status=all');
      expect(departments).toEqual(expect.arrayContaining(ids('D1a', 'D1b', 'D3')));
      expect(departments).not.toContain(id['D2']);
      await api(token).get(`/departments/${id['D3']}`).expect(200);
      await api(token).get(`/departments/${id['D2']}`).expect(404);
    });

    it('read and manage scopes are independent: reading S1 and S2 but managing S1 only', async () => {
      const account = await addUser(owner, adminA, 'mixed');
      await grantPermissions(owner, account, [PERMISSIONS.ORGANIZATION_READ], {
        type: 'company',
        id: id['C1'],
      });
      await grantPermissions(owner, account, [PERMISSIONS.ORGANIZATION_MANAGE], {
        type: 'site',
        id: id['S1'],
      });
      const token = await tokenOf(account);

      await api(token).get(`/departments/${id['D2']}`).expect(200);
      // Visible but not manageable: the write is refused as "not found" within the manage scope.
      await api(token).patch(`/departments/${id['D2']}`, { name: 'Nope', version: 1 }).expect(404);
      const d1b = await api(token).get(`/departments/${id['D1b']}`).expect(200);
      await api(token)
        .patch(`/departments/${id['D1b']}`, { name: 'D1b', version: d1b.body.version })
        .expect(200);
    });
  });

  // ------------------------------------------------- assigning with a scope

  describe('assigning a role on a scope', () => {
    let roleId: string;
    let member: Account;

    beforeAll(async () => {
      const admin = api(adminToken);
      roleId = (
        await admin.post('/roles', { name: 'Chef de site', permissions: [...ORG] }).expect(201)
      ).body.id;
      member = await addUser(owner, adminA, 'member');
    });

    const assign = (token: string, userId: string, body: object) =>
      api(token).post(`/users/${userId}/role-assignments`, body);

    it('an administrator assigns a role on a site; it shows on the user with the scope name, and takes effect at once', async () => {
      const token = await tokenOf(member);
      await api(token).get('/sites').expect(403); // no role yet

      const created = await assign(adminToken, member.userId, {
        roleId,
        scopeType: 'site',
        scopeId: id['S2'],
      }).expect(201);
      expect(created.body).toMatchObject({
        role: { id: roleId, name: 'Chef de site' },
        scopeType: 'site',
        scopeId: id['S2'],
        scopeName: 'Site S2',
      });
      // Idempotent: same assignment, same id.
      const again = await assign(adminToken, member.userId, {
        roleId,
        scopeType: 'site',
        scopeId: id['S2'],
      }).expect(201);
      expect(again.body.id).toBe(created.body.id);

      expect(await idsOf(token, '/sites')).toEqual(ids('S2')); // same access token
      const listed = await api(adminToken).get('/users?search=member@').expect(200);
      expect(listed.body.items[0].assignments).toEqual([
        expect.objectContaining({ id: created.body.id, scopeType: 'site', scopeName: 'Site S2' }),
      ]);

      // A second scope adds up; withdrawing one leaves the other.
      const second = await assign(adminToken, member.userId, {
        roleId,
        scopeType: 'department',
        scopeId: id['D3'],
      }).expect(201);
      expect(await idsOf(token, '/departments')).toEqual(ids('D2', 'D3'));
      await api(adminToken)
        .delete(`/users/${member.userId}/role-assignments/${created.body.id}`)
        .expect(204);
      expect(await idsOf(token, '/departments')).toEqual(ids('D3'));
      await api(adminToken)
        .delete(`/users/${member.userId}/role-assignments/${second.body.id}`)
        .expect(204);
      await api(token).get('/departments').expect(403);

      const events = await asTenant(owner, adminA.tenantId, async () => {
        const result = await owner.query(
          `SELECT action, metadata FROM audit_events WHERE resource_id = $1 AND action LIKE 'role.%' ORDER BY occurred_at`,
          [member.userId],
        );
        return result.rows as { action: string; metadata: Record<string, unknown> }[];
      });
      expect(
        events.map((event) => [
          event.action,
          event.metadata['scopeType'],
          event.metadata['scopeId'],
        ]),
      ).toEqual([
        ['role.assigned', 'site', id['S2']],
        ['role.assigned', 'department', id['D3']],
        ['role.unassigned', 'site', id['S2']],
        ['role.unassigned', 'department', id['D3']],
      ]);
    });

    it('validates the scope of the request', async () => {
      for (const body of [
        { roleId, scopeType: 'site' },
        { roleId, scopeType: 'tenant', scopeId: id['S1'] },
        { roleId, scopeType: 'project', scopeId: id['S1'] },
        { roleId, scopeType: 'site', scopeId: 'nope' },
      ]) {
        await assign(adminToken, member.userId, body).expect(400);
      }
    });

    it('a scope that does not exist, of the wrong kind, or of another tenant is refused as not found', async () => {
      const companyOfB = (
        await api(await tokenOf(adminB))
          .post('/companies', { code: 'B-CO', name: 'Company of B' })
          .expect(201)
      ).body.id;
      for (const body of [
        { roleId, scopeType: 'site', scopeId: uuidv7() },
        { roleId, scopeType: 'site', scopeId: id['C1'] }, // a company id given as a site
        { roleId, scopeType: 'company', scopeId: companyOfB },
      ]) {
        const response = await assign(adminToken, member.userId, body).expect(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    });

    it('…and by the database itself: an assignment cannot point at a scope of another tenant', async () => {
      const companyOfB = (
        await api(await tokenOf(adminB))
          .post('/companies', { code: 'B-CO2', name: 'Company of B 2' })
          .expect(201)
      ).body.id;
      const runtime = createAppClient();
      await runtime.connect();
      try {
        const insert = (scopeType: string, scopeKey: string, companyId: string | null) =>
          sqlState(() =>
            asTenant(runtime, adminA.tenantId, () =>
              runtime.query(
                `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, scope_key, company_id)
                 VALUES ($1, $2, $3, $4, $5::access_scope_type, $6, $7)`,
                [uuidv7(), adminA.tenantId, member.userId, roleId, scopeType, scopeKey, companyId],
              ),
            ),
          );
        expect(await insert('COMPANY', companyOfB, companyOfB)).toBe('23503'); // foreign key
        expect(await insert('COMPANY', 'tenant', id['C1'])).toBe('23514'); // inconsistent scope
        expect(await insert('TENANT', 'tenant', id['C1'])).toBe('23514');
        expect(await insert('SITE', id['C1'], id['C1'])).toBe('23514');
      } finally {
        await runtime.end();
      }
    });

    describe('a site manager who may assign roles on S1 only', () => {
      let manager: { account: Account; token: string };
      const SITE_MANAGER = [...ORG, PERMISSIONS.ROLE_ASSIGN];

      beforeAll(async () => {
        manager = await scopedUser(SITE_MANAGER, { type: 'site', id: id['S1'] });
      });

      it('assigns inside their scope: on S1 and on a department of S1', async () => {
        const first = await assign(manager.token, member.userId, {
          roleId,
          scopeType: 'site',
          scopeId: id['S1'],
        }).expect(201);
        const second = await assign(manager.token, member.userId, {
          roleId,
          scopeType: 'department',
          scopeId: id['D1a'],
        }).expect(201);
        await api(manager.token)
          .delete(`/users/${member.userId}/role-assignments/${first.body.id}`)
          .expect(204);
        await api(manager.token)
          .delete(`/users/${member.userId}/role-assignments/${second.body.id}`)
          .expect(204);
      });

      it('cannot assign outside their scope: another site, the company above, the whole tenant', async () => {
        for (const body of [
          { roleId, scopeType: 'site', scopeId: id['S2'] },
          { roleId, scopeType: 'department', scopeId: id['D2'] },
          { roleId, scopeType: 'company', scopeId: id['C1'] },
          { roleId, scopeType: 'tenant' },
          { roleId },
        ]) {
          const response = await assign(manager.token, member.userId, body).expect(404);
          expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
        }
        const listed = await api(adminToken).get('/users?search=member@').expect(200);
        expect(listed.body.items[0].assignments).toEqual([]);
      });

      it('cannot assign, even inside their scope, a role carrying a permission they do not hold there', async () => {
        const powerful = (
          await api(adminToken)
            .post('/roles', { name: 'Journal du site', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
            .expect(201)
        ).body.id;
        const response = await assign(manager.token, member.userId, {
          roleId: powerful,
          scopeType: 'site',
          scopeId: id['S1'],
        }).expect(403);
        expect(response.body).toMatchObject({
          code: 'FORBIDDEN',
          details: { reason: 'missing_permissions' },
        });
        // Nor the administrator role.
        const adminRole = await asTenant(
          owner,
          adminA.tenantId,
          async () =>
            (await owner.query<{ id: string }>('SELECT id FROM roles WHERE is_system')).rows[0]?.id,
        );
        await assign(manager.token, member.userId, {
          roleId: adminRole,
          scopeType: 'site',
          scopeId: id['S1'],
        }).expect(403);
      });

      it('cannot assign to themselves, and cannot withdraw an assignment made outside their scope', async () => {
        await assign(manager.token, manager.account.userId, {
          roleId,
          scopeType: 'site',
          scopeId: id['S1'],
        }).expect(403);

        const elsewhere = await assign(adminToken, member.userId, {
          roleId,
          scopeType: 'site',
          scopeId: id['S2'],
        }).expect(201);
        const tenantWide = await assign(adminToken, member.userId, { roleId }).expect(201);
        for (const assignmentId of [elsewhere.body.id, tenantWide.body.id, uuidv7()]) {
          await api(manager.token)
            .delete(`/users/${member.userId}/role-assignments/${assignmentId}`)
            .expect(404);
        }
        // An assignment id used with another user does not match either.
        await api(adminToken)
          .delete(`/users/${adminA.userId}/role-assignments/${elsewhere.body.id}`)
          .expect(404);
        await api(adminToken)
          .delete(`/users/${member.userId}/role-assignments/${elsewhere.body.id}`)
          .expect(204);
        await api(adminToken)
          .delete(`/users/${member.userId}/role-assignments/${tenantWide.body.id}`)
          .expect(204);
      });
    });

    it('the administrator role on a site makes a site administrator, not a tenant administrator', async () => {
      const adminRole = await asTenant(
        owner,
        adminA.tenantId,
        async () =>
          (await owner.query<{ id: string }>('SELECT id FROM roles WHERE is_system')).rows[0]
            ?.id as string,
      );
      const local = await addUser(owner, adminA, 'local-admin');
      const created = await assign(adminToken, local.userId, {
        roleId: adminRole,
        scopeType: 'site',
        scopeId: id['S1'],
      }).expect(201);
      const token = await tokenOf(local);

      expect(await idsOf(token, '/sites')).toEqual(ids('S1'));
      await api(token).get('/roles').expect(403);
      await api(token).get('/audit-events').expect(403);
      // Withdrawing it is not subject to the "last administrator" rule, which is about
      // tenant-wide administrators.
      await api(adminToken)
        .delete(`/users/${local.userId}/role-assignments/${created.body.id}`)
        .expect(204);
    });
  });
});
