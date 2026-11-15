import type pg from 'pg';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  MissingTenantContextError,
  runInTenantContext,
  TenantDatabase,
  uuidv7,
} from '../src/tenancy/index.js';
import {
  createTenant,
  TenantAlreadyExistsError,
} from '../src/tenancy/provisioning/create-tenant.js';
import { TenantScopeError } from '../src/tenancy/tenant-scope.js';
import { createTestApp, type TestApp } from './create-test-app.js';
import { createAppClient, createOwnerClient, resetDatabase } from './support/db.js';
import { asTenant, seedTenant, sqlState, type TenantFixture } from './support/tenants.js';

/** The application's own data path: TenantDatabase on top of Row-Level Security. */
describe('tenant isolation — TenantDatabase (application path)', () => {
  let app: TestApp;
  let db: TenantDatabase;
  let prisma: PrismaService;
  let owner: pg.Client;
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    await owner.connect();
    a = await seedTenant(owner, 'app-alpha', 3);
    b = await seedTenant(owner, 'app-bravo', 2);
    // A pool of 2 connections for the whole suite: every test below would expose a
    // tenant binding leaking from one pooled connection to the next user.
    app = await createTestApp({ DATABASE_POOL_MAX: 2 });
    db = app.get(TenantDatabase);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  const inTenant = <T>(tenant: TenantFixture, fn: () => Promise<T>): Promise<T> =>
    runInTenantContext({ tenantId: tenant.tenantId }, fn);

  it('refuses to run outside of a tenant context', async () => {
    await expect(db.run((tx) => tx.user.findMany())).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('lists and counts only the rows of the current tenant', async () => {
    const [users, count] = await inTenant(a, () =>
      db.run(async (tx) => [await tx.user.findMany(), await tx.user.count()] as const),
    );
    expect(users.map((user) => user.id).sort()).toEqual([...a.userIds].sort());
    expect(count).toBe(3);
  });

  it('a row of another tenant is indistinguishable from a row that does not exist', async () => {
    const [foreign, missing] = await inTenant(a, () =>
      db.run(async (tx) => [
        await tx.user.findUnique({ where: { id: b.userIds[0] } }),
        await tx.user.findUnique({ where: { id: uuidv7() } }),
      ]),
    );
    expect(foreign).toBeNull();
    expect(missing).toBeNull();
  });

  it('asking explicitly for another tenant returns nothing', async () => {
    const users = await inTenant(a, () =>
      db.run((tx) => tx.user.findMany({ where: { tenantId: b.tenantId } })),
    );
    expect(users).toEqual([]);
  });

  it('cannot update or delete a row of another tenant', async () => {
    const results = await inTenant(a, () =>
      db.run(async (tx) => [
        await tx.user.updateMany({ where: { id: b.userIds[0] }, data: { status: 'DISABLED' } }),
        await tx.user.deleteMany({ where: { id: b.userIds[0] } }),
      ]),
    );
    expect(results).toEqual([{ count: 0 }, { count: 0 }]);

    await expect(
      inTenant(a, () =>
        db.run((tx) =>
          tx.user.update({ where: { id: b.userIds[0] }, data: { status: 'DISABLED' } }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('a created row always belongs to the current tenant, whatever the caller supplies', async () => {
    const id = uuidv7();
    await inTenant(a, () =>
      db.run((tx) =>
        tx.user.create({
          data: { id, email: 'created@app-alpha.example.test', tenantId: b.tenantId },
        }),
      ),
    );

    const stored = await asTenant(owner, a.tenantId, async () => {
      const result = await owner.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM users WHERE id = $1',
        [id],
      );
      return result.rows;
    });
    expect(stored).toEqual([{ tenant_id: a.tenantId }]);

    await inTenant(a, () => db.run((tx) => tx.user.delete({ where: { id } })));
  });

  it('an update cannot move a row to another tenant', async () => {
    await inTenant(a, () =>
      db.run((tx) =>
        tx.user.update({
          where: { id: a.userIds[0] },
          data: { tenantId: b.tenantId, version: { increment: 1 } },
        }),
      ),
    );
    const visibleFromB = await inTenant(b, () =>
      db.run((tx) => tx.user.findUnique({ where: { id: a.userIds[0] } })),
    );
    expect(visibleFromB).toBeNull();
  });

  it('raw SQL inside a unit of work is still confined by Row-Level Security', async () => {
    const rows = await inTenant(a, () =>
      db.run((tx) => tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM users`),
    );
    expect(rows.length).toBe(3);
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([a.tenantId]));
  });

  it('exposes only the current tenant of the registry, read-only', async () => {
    const tenants = await inTenant(a, () => db.run((tx) => tx.tenant.findMany()));
    expect(tenants.map((tenant) => tenant.id)).toEqual([a.tenantId]);

    await expect(
      inTenant(a, () =>
        db.run((tx) => tx.tenant.update({ where: { id: a.tenantId }, data: { name: 'Renamed' } })),
      ),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('a unit of work is atomic: an error rolls back what it wrote', async () => {
    const id = uuidv7();
    await expect(
      inTenant(a, () =>
        db.run(async (tx) => {
          await tx.user.create({ data: { id, email: 'rollback@app-alpha.example.test' } as never });
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');

    const found = await inTenant(a, () => db.run((tx) => tx.user.findUnique({ where: { id } })));
    expect(found).toBeNull();
  });

  it('the raw client, used without a tenant, sees nothing (fail closed)', async () => {
    expect(await prisma.user.findMany()).toEqual([]);
    expect(await prisma.tenant.findMany()).toEqual([]);
  });

  it('never leaks through the connection pool: 240 interleaved units of work on 2 connections', async () => {
    const tenants = [a, b];
    const jobs = Array.from(
      { length: 240 },
      (_unused, index) => tenants[index % 2] as TenantFixture,
    );
    const BATCH = 8;
    let checked = 0;

    for (let start = 0; start < jobs.length; start += BATCH) {
      await Promise.all(
        jobs.slice(start, start + BATCH).map((tenant) =>
          inTenant(tenant, () =>
            db.run(async (tx) => {
              const users = await tx.user.findMany();
              // Yield so that units of work of both tenants overlap on the pool.
              await new Promise((resolve) => setImmediate(resolve));
              const raw = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM users`;
              const bound = await tx.$queryRaw<{ value: string }[]>`
                SELECT current_setting('app.tenant_id', true) AS value`;

              expect(bound[0]?.value).toBe(tenant.tenantId);
              expect(users.length).toBeGreaterThan(0);
              for (const row of [
                ...users.map((user) => user.tenantId),
                ...raw.map((r) => r.tenant_id),
              ]) {
                expect(row).toBe(tenant.tenantId);
              }
              checked += 1;
            }),
          ),
        ),
      );
      // Between batches, pooled connections must carry no tenant at all.
      expect(await prisma.user.findMany()).toEqual([]);
    }

    expect(checked).toBe(240);
  });
});

describe('tenant provisioning (decision D-13)', () => {
  let app: TestApp;
  let owner: pg.Client;
  let runtime: pg.Client;

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    runtime = createAppClient();
    await Promise.all([owner.connect(), runtime.connect()]);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([owner.end(), runtime.end()]);
  });

  it('creates a tenant with a UUID v7 id and a normalised slug', async () => {
    const tenant = await createTenant(owner, {
      slug: '  ACME-Congo ',
      name: ' ACME Congo (DEMO) ',
    });

    expect(tenant).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/),
      slug: 'acme-congo',
      name: 'ACME Congo (DEMO)',
    });
    const { rows } = await owner.query('SELECT slug, name, status FROM tenants WHERE id = $1', [
      tenant.id,
    ]);
    expect(rows).toEqual([{ slug: 'acme-congo', name: 'ACME Congo (DEMO)', status: 'ACTIVE' }]);
  });

  it('installs the reference roles, with a single system administrator role', async () => {
    const { rows: tenants } = await owner.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = 'acme-congo'`,
    );
    const tenantId = tenants[0]?.id as string;
    const roles = await asTenant(owner, tenantId, async () => {
      const result = await owner.query(
        `SELECT r.reference_key, r.is_system,
                (SELECT count(*)::int FROM role_permissions p WHERE p.role_id = r.id) AS permissions
           FROM roles r ORDER BY r.reference_key`,
      );
      return result.rows;
    });
    expect(roles).toEqual([
      { reference_key: 'administrator', is_system: true, permissions: 0 },
      { reference_key: 'auditor', is_system: false, permissions: 1 },
      { reference_key: 'qhse-manager', is_system: false, permissions: 4 },
    ]);
  });

  it('refuses a duplicate slug', async () => {
    await expect(createTenant(owner, { slug: 'acme-congo', name: 'Other' })).rejects.toBeInstanceOf(
      TenantAlreadyExistsError,
    );
  });

  it.each(['ab', 'Has Space', 'trailing-', '--x', 'é-accent', 'a'.repeat(51)])(
    'refuses the slug %p',
    async (slug) => {
      await expect(createTenant(owner, { slug, name: 'Valid name' })).rejects.toThrow();
    },
  );

  it('the database itself refuses a malformed slug', async () => {
    const state = await sqlState(() =>
      owner.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
        uuidv7(),
        'Bad Slug',
        'x',
      ]),
    );
    expect(state).toBe('23514');
  });

  it('cannot be done with the runtime role of the API', async () => {
    const state = await sqlState(() =>
      createTenant(runtime, { slug: 'runtime-made', name: 'Nope' }),
    );
    expect(state).toBe('42501');
  });

  it.each([
    ['get', '/api/v1/tenants'],
    ['post', '/api/v1/tenants'],
    ['delete', '/api/v1/tenants'],
  ] as const)('exposes no HTTP endpoint: %s %s', async (method, url) => {
    const response = await request(app.getHttpServer())[method](url).expect(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
