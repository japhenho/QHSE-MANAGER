import { Controller, Get } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PERMISSION_KEYS, PERMISSIONS } from '@qhse/shared';
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
import { createOwnerClient, resetDatabase } from './support/db.js';
import {
  expectInvisibleAcrossTenants,
  expectListExcludes,
  expectPermissionRequired,
} from './support/endpoint-contract.js';
import { asTenant } from './support/tenants.js';

/** A route nobody declared a permission for: it must be refused to everyone. */
@Controller('undeclared-probe')
class UndeclaredProbeController {
  @Get()
  read(): { leaked: boolean } {
    return { leaked: true };
  }
}

describe('access control (RBAC)', () => {
  let app: TestApp;
  let owner: pg.Client;
  // Tenant A
  let adminA: Account;
  let nobodyA: Account; // signed in, no role
  let memberA: Account; // target of assignments
  // Tenant B
  let adminB: Account;
  const tokens: Record<string, string> = {};
  let adminRoleA: string;
  let adminRoleB: string;

  const api = (token: string) => {
    const agent = request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${token}` };
    return {
      get: (url: string) => agent.get(`/api/v1${url}`).set(auth),
      post: (url: string, body: object) => agent.post(`/api/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => agent.patch(`/api/v1${url}`).set(auth).send(body),
      put: (url: string) => agent.put(`/api/v1${url}`).set(auth),
      delete: (url: string) => agent.delete(`/api/v1${url}`).set(auth),
    };
  };

  async function tokenOf(account: Account): Promise<string> {
    app.get(RateLimiter).reset();
    return (await openSession(app, account)).accessToken;
  }

  async function systemRoleOf(account: Account): Promise<string> {
    return asTenant(owner, account.tenantId, async () => {
      const result = await owner.query<{ id: string }>('SELECT id FROM roles WHERE is_system');
      return result.rows[0]?.id as string;
    });
  }

  async function auditActions(account: Account): Promise<string[]> {
    return asTenant(owner, account.tenantId, async () => {
      const result = await owner.query<{ action: string }>(
        'SELECT action FROM audit_events ORDER BY occurred_at',
      );
      return result.rows.map((row) => row.action);
    });
  }

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    await owner.connect();
    adminA = await seedAccount(owner, 'rbac-alpha', { administrator: true });
    nobodyA = await addUser(owner, adminA, 'nobody');
    memberA = await addUser(owner, adminA, 'member');
    adminB = await seedAccount(owner, 'rbac-bravo', { administrator: true });
    app = await createTestApp({}, { controllers: [UndeclaredProbeController] });
    tokens['adminA'] = await tokenOf(adminA);
    tokens['nobodyA'] = await tokenOf(nobodyA);
    tokens['adminB'] = await tokenOf(adminB);
    adminRoleA = await systemRoleOf(adminA);
    adminRoleB = await systemRoleOf(adminB);
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  // ------------------------------------------------------- deny by default

  describe('deny by default', () => {
    it('a route without any declaration answers 403, even to an administrator', async () => {
      const response = await api(tokens['adminA'] as string)
        .get('/undeclared-probe')
        .expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(JSON.stringify(response.body)).not.toContain('leaked');
      await request(app.getHttpServer()).get('/api/v1/undeclared-probe').expect(401);
    });

    it('every registered route either is public, or needs a permission, or is explicitly open to any signed-in user', async () => {
      const PUBLIC = new Set([
        'GET /api/v1/health/live',
        'GET /api/v1/health/ready',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/refresh',
        'POST /api/v1/auth/logout',
      ]);
      // Exact list: opening a route to every signed-in user must be a decision.
      const AUTHENTICATED_ONLY = new Set(['GET /api/v1/auth/me']);

      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
      const routes = Object.entries(document.paths).flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
      );
      expect(routes.length).toBeGreaterThan(10);

      // Called by a signed-in user who holds no role at all.
      const open: string[] = [];
      for (const route of routes.filter((item) => !PUBLIC.has(item))) {
        const [method, path] = route.split(' ') as [string, string];
        const url = path.replace(/\{[^}]+\}/g, () => uuidv7());
        const http = request(app.getHttpServer());
        const response = await http[method.toLowerCase() as 'get'](url)
          .set('Authorization', `Bearer ${tokens['nobodyA'] as string}`)
          .send({});
        if (response.status !== 403) open.push(route);
      }
      expect(open.sort()).toEqual([...AUTHENTICATED_ONLY].sort());
    });

    it('an account without role is told so in /auth/me, an administrator holds the whole catalogue', async () => {
      const nobody = await api(tokens['nobodyA'] as string)
        .get('/auth/me')
        .expect(200);
      expect(nobody.body.permissions).toEqual([]);
      const admin = await api(tokens['adminA'] as string)
        .get('/auth/me')
        .expect(200);
      expect(admin.body.permissions).toEqual([...PERMISSION_KEYS].sort());
    });
  });

  // -------------------------------------------------- CC-1 / CC-2 harness

  describe('CC-1 and CC-2 for every endpoint', () => {
    let roleOfA: string;

    beforeAll(async () => {
      const created = await api(tokens['adminA'] as string)
        .post('/roles', { name: 'Chef de quart', permissions: [PERMISSIONS.USER_READ] })
        .expect(201);
      roleOfA = created.body.id as string;
    });

    it('CC-2: each endpoint refuses an anonymous caller (401) and a caller without the permission (403)', async () => {
      const endpoints = [
        { method: 'get', url: '/api/v1/roles' },
        { method: 'get', url: `/api/v1/roles/${roleOfA}` },
        { method: 'post', url: '/api/v1/roles', body: { name: 'Intrus', permissions: [] } },
        { method: 'patch', url: `/api/v1/roles/${roleOfA}`, body: { name: 'Renommé', version: 1 } },
        { method: 'delete', url: `/api/v1/roles/${roleOfA}` },
        { method: 'get', url: '/api/v1/users' },
        { method: 'put', url: `/api/v1/users/${memberA.userId}/roles/${roleOfA}` },
        { method: 'delete', url: `/api/v1/users/${memberA.userId}/roles/${roleOfA}` },
        { method: 'get', url: '/api/v1/audit-events' },
      ] as const;
      for (const endpoint of endpoints) {
        await expectPermissionRequired(app, endpoint, tokens['nobodyA'] as string);
      }
      // Nothing was changed by the refused calls.
      const role = await api(tokens['adminA'] as string)
        .get(`/roles/${roleOfA}`)
        .expect(200);
      expect(role.body).toMatchObject({ name: 'Chef de quart', version: 1, assignedUserCount: 0 });
    });

    it('CC-2: holding another permission is not enough', async () => {
      const reader = await addUser(owner, adminA, 'reader', {
        permissions: [PERMISSIONS.ROLE_READ],
      });
      const token = await tokenOf(reader);
      await api(token).get('/roles').expect(200);
      await api(token).post('/roles', { name: 'Nope', permissions: [] }).expect(403);
      await api(token).get('/users').expect(403);
      await api(token).get('/audit-events').expect(403);
      await api(token).put(`/users/${memberA.userId}/roles/${roleOfA}`).expect(403);
    });

    it('CC-1: a role of tenant A does not exist for an administrator of tenant B', async () => {
      const b = tokens['adminB'] as string;
      for (const endpoint of [
        { method: 'get', url: `/api/v1/roles/${roleOfA}` },
        { method: 'patch', url: `/api/v1/roles/${roleOfA}`, body: { name: 'Pris', version: 1 } },
        { method: 'delete', url: `/api/v1/roles/${roleOfA}` },
      ] as const) {
        await expectInvisibleAcrossTenants(app, endpoint, `/api/v1/roles/${uuidv7()}`, b);
      }
      // Still intact on the side of A.
      const role = await api(tokens['adminA'] as string)
        .get(`/roles/${roleOfA}`)
        .expect(200);
      expect(role.body).toMatchObject({ name: 'Chef de quart', version: 1 });
    });

    it('CC-1: roles and users cannot be combined across tenants', async () => {
      const b = tokens['adminB'] as string;
      const memberB = await addUser(owner, adminB, 'member');
      const roleOfB = (
        await api(b).post('/roles', { name: 'Rôle de B', permissions: [] }).expect(201)
      ).body.id as string;

      // A user of A with a role of B, a user of B with a role of A, both from B and from A.
      for (const [token, userId, roleId] of [
        [b, memberA.userId, roleOfB],
        [b, memberB.userId, roleOfA],
        [tokens['adminA'] as string, memberB.userId, roleOfA],
        [tokens['adminA'] as string, memberA.userId, roleOfB],
      ] as const) {
        const response = await api(token).put(`/users/${userId}/roles/${roleId}`).expect(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
        await api(token).delete(`/users/${userId}/roles/${roleId}`).expect(404);
      }
    });

    it('CC-1: lists and totals of tenant B contain nothing of tenant A', async () => {
      const b = tokens['adminB'] as string;
      await expectListExcludes(app, '/api/v1/roles', b, [roleOfA, adminRoleA]);
      const users = await expectListExcludes(app, '/api/v1/users', b, [
        adminA.userId,
        nobodyA.userId,
        memberA.userId,
      ]);
      expect(users.items.map((user) => user.id)).toContain(adminB.userId);
      await expectListExcludes(app, '/api/v1/audit-events?pageSize=100', b, [
        adminA.userId,
        roleOfA,
      ]);
    });
  });

  // ------------------------------------------------------------ roles CRUD

  describe('roles', () => {
    const admin = () => api(tokens['adminA'] as string);

    it('lists the reference roles installed with the tenant', async () => {
      const response = await admin().get('/roles').expect(200);
      const reference = response.body.items.filter(
        (role: { referenceKey: string | null }) => role.referenceKey,
      );
      expect(reference.map((role: { referenceKey: string }) => role.referenceKey).sort()).toEqual([
        'administrator',
        'auditor',
        'qhse-manager',
      ]);
      const administrator = reference.find((role: { isSystem: boolean }) => role.isSystem);
      expect(administrator).toMatchObject({
        referenceKey: 'administrator',
        permissions: [...PERMISSION_KEYS].sort(),
        assignedUserCount: 1,
      });
    });

    it('an administrator creates a role for a job position, edits it, and deletes it', async () => {
      const created = await admin()
        .post('/roles', {
          name: '  Superviseur de quart ',
          description: 'Suit les rôles et le journal',
          permissions: [PERMISSIONS.ROLE_READ, PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.ROLE_READ],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Superviseur de quart',
        description: 'Suit les rôles et le journal',
        referenceKey: null,
        isSystem: false,
        permissions: ['audit-log:read', 'role:read'],
        assignedUserCount: 0,
        version: 1,
      });
      const id = created.body.id as string;

      const updated = await admin()
        .patch(`/roles/${id}`, {
          name: 'Superviseur',
          permissions: [PERMISSIONS.ROLE_READ],
          version: 1,
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        name: 'Superviseur',
        permissions: ['role:read'],
        version: 2,
      });

      // Optimistic concurrency: the old version is refused, nothing is overwritten.
      const stale = await admin().patch(`/roles/${id}`, { name: 'Écrasé', version: 1 }).expect(409);
      expect(stale.body).toMatchObject({ code: 'CONFLICT' });
      expect((await admin().get(`/roles/${id}`).expect(200)).body.name).toBe('Superviseur');

      await admin().delete(`/roles/${id}`).expect(204);
      await admin().get(`/roles/${id}`).expect(404);

      expect(await auditActions(adminA)).toEqual(
        expect.arrayContaining(['role.created', 'role.updated', 'role.deleted']),
      );
    });

    it('validates the payload: unknown permission, unexpected field, bad identifier', async () => {
      await admin()
        .post('/roles', { name: 'Valide', permissions: ['incident:close'] })
        .expect(400);
      await admin().post('/roles', { name: 'Valide', permissions: [], isSystem: true }).expect(400);
      await admin()
        .post('/roles', { name: 'Valide', permissions: [], tenantId: adminB.tenantId })
        .expect(400);
      await admin().get('/roles/not-a-uuid').expect(400);
      await admin().get('/roles?pageSize=1000').expect(400);
    });

    it('refuses two roles with the same name in a tenant, but allows the same name in another tenant', async () => {
      await admin().post('/roles', { name: 'Magasinier', permissions: [] }).expect(201);
      const duplicate = await admin()
        .post('/roles', { name: 'Magasinier', permissions: [] })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'CONFLICT' });
      await api(tokens['adminB'] as string)
        .post('/roles', { name: 'Magasinier', permissions: [] })
        .expect(201);
    });

    it('the administrator role cannot be modified nor deleted, even by an administrator', async () => {
      await admin().patch(`/roles/${adminRoleA}`, { name: 'Dieu', version: 1 }).expect(403);
      await admin().patch(`/roles/${adminRoleA}`, { permissions: [], version: 1 }).expect(403);
      await admin().delete(`/roles/${adminRoleA}`).expect(403);
      const role = await admin().get(`/roles/${adminRoleA}`).expect(200);
      expect(role.body).toMatchObject({ name: 'Administrateur', isSystem: true });
    });

    it('a role still assigned to someone cannot be deleted', async () => {
      const id = (
        await admin().post('/roles', { name: 'Encore utilisé', permissions: [] }).expect(201)
      ).body.id;
      await admin().put(`/users/${memberA.userId}/roles/${id}`).expect(204);
      const response = await admin().delete(`/roles/${id}`).expect(409);
      expect(response.body).toMatchObject({ code: 'CONFLICT' });
      await admin().delete(`/users/${memberA.userId}/roles/${id}`).expect(204);
      await admin().delete(`/roles/${id}`).expect(204);
    });

    it('paginates with a server-enforced limit', async () => {
      const page = await admin().get('/roles?page=1&pageSize=2').expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body).toMatchObject({ page: 1, pageSize: 2 });
      expect(page.body.total).toBeGreaterThan(2);
    });
  });

  // ------------------------------------------------- privilege escalation

  describe('privilege escalation', () => {
    let manager: Account; // may manage and assign roles, but is not an administrator
    let managerToken: string;
    let managerRoleId: string;

    beforeAll(async () => {
      manager = await addUser(owner, adminA, 'manager');
      managerRoleId = await grantPermissions(owner, manager, [
        PERMISSIONS.ROLE_READ,
        PERMISSIONS.ROLE_MANAGE,
        PERMISSIONS.ROLE_ASSIGN,
      ]);
      managerToken = await tokenOf(manager);
    });

    it('nobody can assign a role to themselves, not even an administrator', async () => {
      await api(managerToken).put(`/users/${manager.userId}/roles/${adminRoleA}`).expect(403);
      const anyRole = (
        await api(tokens['adminA'] as string)
          .post('/roles', { name: 'Auto', permissions: [] })
          .expect(201)
      ).body.id as string;
      await api(tokens['adminA'] as string)
        .put(`/users/${adminA.userId}/roles/${anyRole}`)
        .expect(403);
    });

    it('cannot create a role carrying a permission they do not hold', async () => {
      const response = await api(managerToken)
        .post('/roles', { name: 'Porte dérobée', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      await api(managerToken)
        .post('/roles', { name: 'Honnête', permissions: [PERMISSIONS.ROLE_READ] })
        .expect(201);
    });

    it('cannot add to their own role a permission they do not hold', async () => {
      await api(managerToken)
        .patch(`/roles/${managerRoleId}`, {
          permissions: [
            PERMISSIONS.ROLE_READ,
            PERMISSIONS.ROLE_MANAGE,
            PERMISSIONS.ROLE_ASSIGN,
            PERMISSIONS.USER_READ,
          ],
          version: 1,
        })
        .expect(403);
      expect((await api(managerToken).get('/auth/me').expect(200)).body.permissions).toEqual([
        'role:assign',
        'role:manage',
        'role:read',
      ]);
    });

    it('cannot grant, edit or delete a role more powerful than themselves', async () => {
      const powerful = (
        await api(tokens['adminA'] as string)
          .post('/roles', {
            name: 'Puissant',
            permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.USER_READ],
          })
          .expect(201)
      ).body.id as string;

      await api(managerToken).put(`/users/${memberA.userId}/roles/${powerful}`).expect(403);
      await api(managerToken).put(`/users/${memberA.userId}/roles/${adminRoleA}`).expect(403);
      await api(managerToken)
        .patch(`/roles/${powerful}`, { permissions: [], version: 1 })
        .expect(403);
      await api(managerToken).delete(`/roles/${powerful}`).expect(403);
      // Nor take the administrator role away from the administrator.
      await api(managerToken).delete(`/users/${adminA.userId}/roles/${adminRoleA}`).expect(403);

      const users = await api(tokens['adminA'] as string)
        .get('/users?search=member')
        .expect(200);
      expect(users.body.items[0].roles).toEqual([]);
    });

    it('can grant a role whose permissions they all hold', async () => {
      const modest = (
        await api(managerToken)
          .post('/roles', { name: 'Modeste', permissions: [PERMISSIONS.ROLE_READ] })
          .expect(201)
      ).body.id as string;
      await api(managerToken).put(`/users/${memberA.userId}/roles/${modest}`).expect(204);
      await api(managerToken).put(`/users/${memberA.userId}/roles/${modest}`).expect(204); // idempotent
      await api(managerToken).delete(`/users/${memberA.userId}/roles/${modest}`).expect(204);

      const actions = await auditActions(adminA);
      expect(actions.filter((action) => action === 'role.assigned').length).toBeGreaterThanOrEqual(
        2,
      );
      expect(actions).toContain('role.unassigned');
    });
  });

  // --------------------------------------------- immediate effect of roles

  describe('permissions are evaluated on every request', () => {
    it('a role takes effect, and stops taking effect, at the very next request — same access token', async () => {
      const user = await addUser(owner, adminA, 'live');
      const token = await tokenOf(user);
      const admin = api(tokens['adminA'] as string);
      const role = (
        await admin
          .post('/roles', { name: 'Lecteur du journal', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
          .expect(201)
      ).body.id as string;

      await api(token).get('/audit-events').expect(403);

      await admin.put(`/users/${user.userId}/roles/${role}`).expect(204);
      await api(token).get('/audit-events').expect(200);

      // Editing the role itself is immediate too.
      await admin.patch(`/roles/${role}`, { permissions: [], version: 1 }).expect(200);
      await api(token).get('/audit-events').expect(403);
      await admin
        .patch(`/roles/${role}`, { permissions: [PERMISSIONS.AUDIT_LOG_READ], version: 2 })
        .expect(200);
      await api(token).get('/audit-events').expect(200);

      await admin.delete(`/users/${user.userId}/roles/${role}`).expect(204);
      await api(token).get('/audit-events').expect(403);
    });
  });

  // ---------------------------------------------------- last administrator

  describe('last administrator', () => {
    it('the only administrator of a tenant cannot lose the role', async () => {
      const b = api(tokens['adminB'] as string);
      const response = await b.delete(`/users/${adminB.userId}/roles/${adminRoleB}`).expect(409);
      expect(response.body).toMatchObject({ code: 'CONFLICT' });
      await b.get('/roles').expect(200); // still an administrator
    });

    it('with two administrators one can be withdrawn, then the last one is protected again', async () => {
      const b = api(tokens['adminB'] as string);
      const second = await addUser(owner, adminB, 'second');
      await b.put(`/users/${second.userId}/roles/${adminRoleB}`).expect(204);
      const secondToken = await tokenOf(second);

      // The second administrator withdraws the first one.
      await api(secondToken).delete(`/users/${adminB.userId}/roles/${adminRoleB}`).expect(204);
      await b.get('/roles').expect(403);
      await api(secondToken).delete(`/users/${second.userId}/roles/${adminRoleB}`).expect(409);

      // Restore the first administrator for the other tests.
      await api(secondToken).put(`/users/${adminB.userId}/roles/${adminRoleB}`).expect(204);
    });

    it('a disabled administrator does not count as an administrator', async () => {
      const tenant = await seedAccount(owner, 'rbac-charlie', { administrator: true });
      const spare = await addUser(owner, tenant, 'spare', { administrator: true });
      const role = await systemRoleOf(tenant);
      await asTenant(owner, tenant.tenantId, () =>
        owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [spare.userId]),
      );
      const token = await tokenOf(tenant);

      await api(token).delete(`/users/${tenant.userId}/roles/${role}`).expect(409);
    });
  });

  // -------------------------------------------------------------- users

  describe('users', () => {
    it('lists users with their roles, searchable and paginated', async () => {
      const admin = api(tokens['adminA'] as string);
      const all = await admin.get('/users').expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(3);
      const self = all.body.items.find((user: { id: string }) => user.id === adminA.userId);
      expect(self).toMatchObject({
        email: adminA.email,
        status: 'ACTIVE',
        roles: [{ referenceKey: 'administrator', isSystem: true }],
      });
      // Never any credential material.
      expect(JSON.stringify(all.body)).not.toMatch(/password|hash|argon/i);

      const found = await admin.get('/users?search=NOBODY').expect(200);
      expect(found.body.items.map((user: { email: string }) => user.email)).toEqual([
        nobodyA.email,
      ]);
    });
  });

  // ---------------------------------------------------------- audit log

  describe('audit log consultation', () => {
    const admin = () => api(tokens['adminA'] as string);

    it('returns the most recent events first, with the actor, and never another tenant', async () => {
      const response = await admin().get('/audit-events?pageSize=100').expect(200);
      const items = response.body.items as {
        occurredAt: string;
        action: string;
        actorEmail: string | null;
      }[];
      expect(items.length).toBeGreaterThan(5);
      const times = items.map((item) => Date.parse(item.occurredAt));
      expect(times).toEqual([...times].sort((x, y) => y - x));
      expect(items.find((item) => item.action === 'role.created')?.actorEmail).toEqual(
        expect.any(String),
      );
      expect(JSON.stringify(response.body)).not.toContain(adminB.userId);
    });

    it('filters by action, actor, resource and period', async () => {
      const byAction = await admin().get('/audit-events?action=role.created').expect(200);
      expect(new Set(byAction.body.items.map((item: { action: string }) => item.action))).toEqual(
        new Set(['role.created']),
      );

      const byActor = await admin()
        .get(`/audit-events?actorUserId=${adminA.userId}&pageSize=100`)
        .expect(200);
      expect(
        new Set(byActor.body.items.map((item: { actorUserId: string }) => item.actorUserId)),
      ).toEqual(new Set([adminA.userId]));

      const byResource = await admin()
        .get(`/audit-events?resourceType=user&resourceId=${memberA.userId}`)
        .expect(200);
      expect(byResource.body.total).toBeGreaterThan(0);

      const future = new Date(Date.now() + 3600_000).toISOString();
      expect(
        (
          await admin()
            .get(`/audit-events?from=${encodeURIComponent(future)}`)
            .expect(200)
        ).body.items,
      ).toEqual([]);
      await admin().get('/audit-events?from=yesterday').expect(400);
    });

    it('consulting the journal is itself recorded, once per consultation', async () => {
      const before = (await auditActions(adminA)).filter(
        (action) => action === 'audit_log.viewed',
      ).length;
      await admin().get('/audit-events?action=role.deleted').expect(200);
      await admin().get('/audit-events?action=role.deleted&page=2').expect(200);
      const after = (await auditActions(adminA)).filter(
        (action) => action === 'audit_log.viewed',
      ).length;
      expect(after).toBe(before + 1);
    });

    it('offers no way to change or delete an event', async () => {
      const id = (await admin().get('/audit-events').expect(200)).body.items[0].id as string;
      for (const method of ['patch', 'put', 'delete', 'post'] as const) {
        const http = request(app.getHttpServer());
        const response = await http[method](`/api/v1/audit-events/${id}`).set(
          'Authorization',
          `Bearer ${tokens['adminA'] as string}`,
        );
        expect(response.status).toBe(404);
      }
    });
  });
});
