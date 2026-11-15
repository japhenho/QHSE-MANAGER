import { PERMISSIONS } from '@qhse/shared';
import type pg from 'pg';
import request from 'supertest';
import { RateLimiter } from '../src/auth/rate-limiter.service.js';
import { uuidv7 } from '../src/tenancy/index.js';
import { createTestApp, type TestApp } from './create-test-app.js';
import { type Account, addUser, openSession, seedAccount } from './support/auth.js';
import { createAppClient, createOwnerClient, resetDatabase } from './support/db.js';
import {
  expectInvisibleAcrossTenants,
  expectListExcludes,
  expectPermissionRequired,
} from './support/endpoint-contract.js';
import { asTenant, sqlState } from './support/tenants.js';

const SITE = { countryCode: 'CG', timeZone: 'Africa/Brazzaville', currencyCode: 'XAF' };

describe('organisation: companies, sites, departments', () => {
  let app: TestApp;
  let owner: pg.Client;
  let adminA: Account;
  let adminB: Account;
  let tokenA: string;
  let tokenB: string;
  let tokenNobody: string;
  let tokenReader: string;

  const api = (token: string) => {
    const agent = request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${token}` };
    return {
      get: (url: string) => agent.get(`/api/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => agent.post(`/api/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => agent.patch(`/api/v1${url}`).set(auth).send(body),
    };
  };
  const a = () => api(tokenA);
  const b = () => api(tokenB);

  async function tokenOf(account: Account): Promise<string> {
    app.get(RateLimiter).reset();
    return (await openSession(app, account)).accessToken;
  }

  async function auditOf(account: Account, resourceId: string) {
    return asTenant(owner, account.tenantId, async () => {
      const result = await owner.query(
        `SELECT action, actor_user_id, from_status, to_status, metadata FROM audit_events
          WHERE resource_id = $1 ORDER BY occurred_at`,
        [resourceId],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  const newCompany = async (
    client: ReturnType<typeof api>,
    code: string,
    name = `Company ${code}`,
  ) => (await client.post('/companies', { code, name }).expect(201)).body;
  const newSite = async (
    client: ReturnType<typeof api>,
    companyId: string,
    code: string,
    extra = {},
  ) =>
    (
      await client
        .post('/sites', { companyId, code, name: `Site ${code}`, ...SITE, ...extra })
        .expect(201)
    ).body;
  const newDepartment = async (client: ReturnType<typeof api>, siteId: string, name: string) =>
    (await client.post('/departments', { siteId, name }).expect(201)).body;

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    await owner.connect();
    adminA = await seedAccount(owner, 'org-alpha', { administrator: true });
    adminB = await seedAccount(owner, 'org-bravo', { administrator: true });
    const nobody = await addUser(owner, adminA, 'nobody');
    const reader = await addUser(owner, adminA, 'reader', {
      permissions: [PERMISSIONS.ORGANIZATION_READ],
    });
    app = await createTestApp();
    tokenA = await tokenOf(adminA);
    tokenB = await tokenOf(adminB);
    tokenNobody = await tokenOf(nobody);
    tokenReader = await tokenOf(reader);
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  // ---------------------------------------------------------- CC-1 / CC-2

  describe('CC-1 and CC-2 for every endpoint of the three resources', () => {
    let company: { id: string };
    let site: { id: string };
    let department: { id: string };

    beforeAll(async () => {
      company = await newCompany(a(), 'CC-CO');
      site = await newSite(a(), company.id, 'CC-SITE');
      department = await newDepartment(a(), site.id, 'CC department');
    });

    const endpoints = () =>
      [
        [
          'companies',
          company.id,
          { code: 'NEW-CO', name: 'New company' },
          { name: 'Renamed', version: 1 },
        ],
        [
          'sites',
          site.id,
          { companyId: company.id, code: 'NEW-SITE', name: 'New site', ...SITE },
          { name: 'Renamed', version: 1 },
        ],
        [
          'departments',
          department.id,
          { siteId: site.id, name: 'New department' },
          { name: 'Renamed', version: 1 },
        ],
      ] as const;

    it('CC-2: 401 without a token, 403 without the permission, on all 18 endpoints', async () => {
      for (const [resource, id, createBody, updateBody] of endpoints()) {
        const cases = [
          { method: 'get', url: `/api/v1/${resource}` },
          { method: 'get', url: `/api/v1/${resource}/${id}` },
          { method: 'post', url: `/api/v1/${resource}`, body: createBody },
          { method: 'patch', url: `/api/v1/${resource}/${id}`, body: updateBody },
          { method: 'post', url: `/api/v1/${resource}/${id}/archive` },
          { method: 'post', url: `/api/v1/${resource}/${id}/restore` },
        ] as const;
        for (const endpoint of cases) await expectPermissionRequired(app, endpoint, tokenNobody);
      }
    });

    it('CC-2: reading does not allow writing', async () => {
      const reader = api(tokenReader);
      await reader.get('/companies').expect(200);
      await reader.get(`/sites/${site.id}`).expect(200);
      await reader.post('/companies', { code: 'READER', name: 'By a reader' }).expect(403);
      await reader.patch(`/sites/${site.id}`, { name: 'By a reader', version: 1 }).expect(403);
      await reader.post(`/departments/${department.id}/archive`).expect(403);
    });

    it('CC-1: for another tenant each record is indistinguishable from one that does not exist', async () => {
      for (const [resource, id, , updateBody] of endpoints()) {
        const unknown = `/api/v1/${resource}/${uuidv7()}`;
        const cases = [
          [{ method: 'get', url: `/api/v1/${resource}/${id}` }, unknown],
          [{ method: 'patch', url: `/api/v1/${resource}/${id}`, body: updateBody }, unknown],
          [{ method: 'post', url: `/api/v1/${resource}/${id}/archive` }, `${unknown}/archive`],
          [{ method: 'post', url: `/api/v1/${resource}/${id}/restore` }, `${unknown}/restore`],
        ] as const;
        for (const [endpoint, unknownUrl] of cases) {
          await expectInvisibleAcrossTenants(app, endpoint, unknownUrl, tokenB);
        }
      }
      // Untouched on the side of A.
      expect((await a().get(`/companies/${company.id}`).expect(200)).body).toMatchObject({
        name: 'Company CC-CO',
        version: 1,
        archivedAt: null,
      });
      expect((await a().get(`/departments/${department.id}`).expect(200)).body).toMatchObject({
        version: 1,
        archivedAt: null,
      });
    });

    it('CC-1: lists, filters and totals of another tenant contain nothing of A', async () => {
      const ids = [company.id, site.id, department.id];
      for (const url of [
        '/api/v1/companies?status=all',
        '/api/v1/sites?status=all',
        `/api/v1/sites?companyId=${company.id}&status=all`,
        '/api/v1/departments?status=all',
        `/api/v1/departments?siteId=${site.id}&status=all`,
        '/api/v1/companies?search=CC',
      ]) {
        await expectListExcludes(app, url, tokenB, ids);
      }
    });

    it('CC-1: a child cannot be attached to a parent of another tenant — refused by the API', async () => {
      const companyB = await newCompany(b(), 'B-CO');
      const siteB = await newSite(b(), companyB.id, 'B-SITE');

      const site404 = await a()
        .post('/sites', { companyId: companyB.id, code: 'X-TENANT', name: 'Cross tenant', ...SITE })
        .expect(404);
      expect(site404.body).toMatchObject({ code: 'NOT_FOUND' });
      const dept404 = await a()
        .post('/departments', { siteId: siteB.id, name: 'Cross tenant' })
        .expect(404);
      expect(dept404.body).toMatchObject({ code: 'NOT_FOUND' });

      expect((await b().get(`/sites?companyId=${companyB.id}`).expect(200)).body.total).toBe(1);
      expect((await b().get(`/departments?siteId=${siteB.id}`).expect(200)).body.total).toBe(0);
    });

    it('CC-1: …and refused by the database itself, even with direct SQL of the runtime role', async () => {
      const companyB = await newCompany(b(), 'B-CO2');
      const siteB = await newSite(b(), companyB.id, 'B-SITE2');
      const runtime = createAppClient();
      await runtime.connect();
      try {
        // Bound to tenant A, inserting rows of A that point at parents of B.
        const site = await sqlState(() =>
          asTenant(runtime, adminA.tenantId, () =>
            runtime.query(
              `INSERT INTO sites (id, tenant_id, company_id, code, name, country_code, time_zone, currency_code)
               VALUES ($1, $2, $3, 'SQL-X', 'Cross tenant', 'CG', 'Africa/Brazzaville', 'XAF')`,
              [uuidv7(), adminA.tenantId, companyB.id],
            ),
          ),
        );
        const department = await sqlState(() =>
          asTenant(runtime, adminA.tenantId, () =>
            runtime.query(
              'INSERT INTO departments (id, tenant_id, site_id, name) VALUES ($1, $2, $3, $4)',
              [uuidv7(), adminA.tenantId, siteB.id, 'Cross tenant'],
            ),
          ),
        );
        expect([site, department]).toEqual(['23503', '23503']); // foreign key violations
      } finally {
        await runtime.end();
      }
    });
  });

  // ------------------------------------------------------------- behaviour

  describe('companies', () => {
    it('creates, reads and updates with the version, and audits each step', async () => {
      const created = await newCompany(a(), ' acme-cg ', '  ACME Congo ');
      expect(created).toMatchObject({
        code: 'ACME-CG',
        name: 'ACME Congo',
        version: 1,
        archivedAt: null,
      });
      expect(Date.parse(created.createdAt)).toBeGreaterThan(Date.now() - 60_000);

      const updated = await a()
        .patch(`/companies/${created.id}`, { name: 'ACME Congo SA', version: 1 })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'ACME Congo SA', code: 'ACME-CG', version: 2 });

      const stale = await a()
        .patch(`/companies/${created.id}`, { name: 'Overwritten', version: 1 })
        .expect(409);
      expect(stale.body).toMatchObject({ code: 'CONFLICT', details: { reason: 'stale_version' } });
      expect((await a().get(`/companies/${created.id}`).expect(200)).body.name).toBe(
        'ACME Congo SA',
      );

      expect(await auditOf(adminA, created.id)).toEqual([
        expect.objectContaining({ action: 'company.created', actor_user_id: adminA.userId }),
        expect.objectContaining({
          action: 'company.updated',
          metadata: { changes: { name: 'ACME Congo SA' } },
        }),
      ]);
    });

    it('a code is unique within a tenant, and free in another tenant', async () => {
      await newCompany(a(), 'UNIQ');
      const duplicate = await a()
        .post('/companies', { code: 'uniq', name: 'Same code' })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'CONFLICT', details: { reason: 'code_taken' } });
      await newCompany(b(), 'UNIQ');

      const other = await newCompany(a(), 'UNIQ-2');
      await a().patch(`/companies/${other.id}`, { code: 'UNIQ', version: 1 }).expect(409);
    });

    it.each([
      [{ code: 'a b', name: 'Valid name' }, 'code'],
      [{ code: 'A', name: 'Valid name' }, 'code'],
      [{ code: 'VALID', name: 'x' }, 'name'],
      [{ code: 'VALID', name: 'Valid', tenantId: '0193a000-0000-7000-8000-000000000000' }, ''],
      [{ code: 'VALID', name: 'Valid', archivedAt: null }, ''],
    ])('rejects the payload %j', async (body, path) => {
      const response = await a().post('/companies', body).expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.details[0].path).toBe(path);
    });
  });

  describe('sites', () => {
    let company: { id: string };
    beforeAll(async () => {
      company = await newCompany(a(), 'SITES-CO', 'Sites company');
    });

    it('carries a country, an IANA time zone and a currency', async () => {
      const site = await newSite(a(), company.id, 'djeno', {
        name: 'Terminal de Djeno',
        countryCode: 'cg',
        currencyCode: 'xaf',
      });
      expect(site).toMatchObject({
        companyId: company.id,
        companyName: 'Sites company',
        code: 'DJENO',
        name: 'Terminal de Djeno',
        countryCode: 'CG',
        timeZone: 'Africa/Brazzaville',
        currencyCode: 'XAF',
      });
      const updated = await a()
        .patch(`/sites/${site.id}`, {
          countryCode: 'CD',
          timeZone: 'Africa/Kinshasa',
          currencyCode: 'CDF',
          version: 1,
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        countryCode: 'CD',
        timeZone: 'Africa/Kinshasa',
        currencyCode: 'CDF',
        version: 2,
      });
    });

    it.each([
      ['countryCode', 'XX'],
      ['countryCode', 'Congo'],
      ['timeZone', 'Africa/Atlantis'],
      ['timeZone', 'GMT+1'],
      ['currencyCode', 'ZZZ'],
      ['currencyCode', 'FCFA'],
    ])('rejects an unknown %s (%s) with 400 VALIDATION_FAILED', async (field, value) => {
      const response = await a()
        .post('/sites', {
          companyId: company.id,
          code: 'BAD',
          name: 'Bad site',
          ...SITE,
          [field]: value,
        })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(response.body.details.map((d: { path: string }) => d.path)).toEqual([field]);

      const existing = await newSite(
        a(),
        company.id,
        `OK-${field.slice(0, 3)}-${value.length}${value.charCodeAt(0)}`,
      );
      await a()
        .patch(`/sites/${existing.id}`, { [field]: value, version: 1 })
        .expect(400);
    });

    it('cannot be moved to another company', async () => {
      const site = await newSite(a(), company.id, 'FIXED');
      const other = await newCompany(a(), 'OTHER-CO');
      await a().patch(`/sites/${site.id}`, { companyId: other.id, version: 1 }).expect(400);
    });

    it('a site code is unique within the tenant, across companies', async () => {
      const other = await newCompany(a(), 'SITES-CO2');
      await newSite(a(), company.id, 'SAME');
      const duplicate = await a()
        .post('/sites', { companyId: other.id, code: 'SAME', name: 'Same', ...SITE })
        .expect(409);
      expect(duplicate.body.details).toEqual({ reason: 'code_taken' });
      const companyB = await newCompany(b(), 'SITES-B');
      await newSite(b(), companyB.id, 'SAME');
    });
  });

  describe('departments', () => {
    it('belongs to a site; its name is unique within the site only', async () => {
      const company = await newCompany(a(), 'DEPT-CO');
      const site1 = await newSite(a(), company.id, 'DEPT-S1');
      const site2 = await newSite(a(), company.id, 'DEPT-S2');

      const department = await newDepartment(a(), site1.id, ' Maintenance ');
      expect(department).toMatchObject({
        siteId: site1.id,
        siteName: 'Site DEPT-S1',
        name: 'Maintenance',
        version: 1,
      });
      const duplicate = await a()
        .post('/departments', { siteId: site1.id, name: 'Maintenance' })
        .expect(409);
      expect(duplicate.body.details).toEqual({ reason: 'name_taken' });
      await newDepartment(a(), site2.id, 'Maintenance');

      await a().post('/departments', { siteId: uuidv7(), name: 'Orphan' }).expect(404);
      await a()
        .patch(`/departments/${department.id}`, { siteId: site2.id, version: 1 })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------- lists

  describe('lists', () => {
    let company: { id: string };
    // Same letter case on purpose: the order of mixed-case text depends on the collation
    // of the PostgreSQL cluster, which differs between environments.
    const names = ['Charlie', 'Alpha', 'Bravo'];

    beforeAll(async () => {
      company = await newCompany(a(), 'LIST-CO', 'Listing company');
      for (const [index, name] of names.entries()) {
        await a()
          .post('/sites', {
            companyId: company.id,
            code: `LIST-${String(3 - index)}`,
            name,
            ...SITE,
          })
          .expect(201);
      }
    });

    const list = (query: string) => a().get(`/sites?companyId=${company.id}&${query}`);
    const namesOf = (body: { items: { name: string }[] }) => body.items.map((item) => item.name);

    it('sorts by name by default, by code or creation date on request, in both directions', async () => {
      expect(namesOf((await list('').expect(200)).body)).toEqual(['Alpha', 'Bravo', 'Charlie']);
      expect(namesOf((await list('sort=name&order=desc').expect(200)).body)).toEqual([
        'Charlie',
        'Bravo',
        'Alpha',
      ]);
      expect(namesOf((await list('sort=code').expect(200)).body)).toEqual([
        'Bravo',
        'Alpha',
        'Charlie',
      ]);
      expect(namesOf((await list('sort=createdAt&order=desc').expect(200)).body)).toEqual([
        'Bravo',
        'Alpha',
        'Charlie',
      ]);
    });

    it('searches name and code, case-insensitively', async () => {
      expect(namesOf((await list('search=ALPH').expect(200)).body)).toEqual(['Alpha']);
      expect(namesOf((await list('search=list-3').expect(200)).body)).toEqual(['Charlie']);
      expect((await list('search=nothing-matches').expect(200)).body).toMatchObject({
        items: [],
        total: 0,
      });
    });

    it('filters by parent', async () => {
      const other = await newCompany(a(), 'LIST-CO2');
      await newSite(a(), other.id, 'ELSEWHERE');
      expect((await list('').expect(200)).body.total).toBe(3);
      expect((await a().get(`/sites?companyId=${other.id}`).expect(200)).body.total).toBe(1);
    });

    it('paginates without overlap, with a total', async () => {
      const first = (await list('pageSize=2&page=1').expect(200)).body;
      const second = (await list('pageSize=2&page=2').expect(200)).body;
      expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect([...namesOf(first), ...namesOf(second)]).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it.each([
      'pageSize=101',
      'pageSize=0',
      'page=0',
      'sort=tenantId',
      'order=sideways',
      'status=deleted',
      'companyId=nope',
    ])('refuses the query %s', async (query) => {
      const response = await a().get(`/sites?${query}`).expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------- archiving

  describe('archiving', () => {
    it('an archived record leaves the default lists, stays readable by filter, and can be restored', async () => {
      const company = await newCompany(a(), 'ARCH-CO', 'To be archived');

      const archived = await a().post(`/companies/${company.id}/archive`).expect(200);
      expect(archived.body.archivedAt).toEqual(expect.any(String));
      expect(archived.body.version).toBe(2);
      await a().post(`/companies/${company.id}/archive`).expect(200); // idempotent

      const ids = async (query: string) =>
        (await a().get(`/companies?search=ARCH-CO&${query}`).expect(200)).body.items.map(
          (item: { id: string }) => item.id,
        );
      expect(await ids('')).toEqual([]);
      expect(await ids('status=archived')).toEqual([company.id]);
      expect(await ids('status=all')).toEqual([company.id]);
      expect(
        (await a().get(`/companies/${company.id}`).expect(200)).body.archivedAt,
      ).not.toBeNull();

      // Read-only while archived.
      const edit = await a()
        .patch(`/companies/${company.id}`, { name: 'Edited', version: 2 })
        .expect(409);
      expect(edit.body.details).toEqual({ reason: 'archived' });

      const restored = await a().post(`/companies/${company.id}/restore`).expect(200);
      expect(restored.body).toMatchObject({ archivedAt: null, version: 3 });
      expect(await ids('')).toEqual([company.id]);

      expect(
        (await auditOf(adminA, company.id)).map((event) => [
          event['action'],
          event['from_status'],
          event['to_status'],
        ]),
      ).toEqual([
        ['company.created', null, null],
        ['company.archived', 'ACTIVE', 'ARCHIVED'],
        ['company.restored', 'ARCHIVED', 'ACTIVE'],
      ]);
    });

    it('a parent with active children cannot be archived; children go first', async () => {
      const company = await newCompany(a(), 'TREE-CO');
      const site = await newSite(a(), company.id, 'TREE-SITE');
      const department = await newDepartment(a(), site.id, 'Tree department');

      for (const url of [`/companies/${company.id}/archive`, `/sites/${site.id}/archive`]) {
        const response = await a().post(url).expect(409);
        expect(response.body.details).toEqual({ reason: 'has_active_children' });
      }
      await a().post(`/departments/${department.id}/archive`).expect(200);
      await a().post(`/sites/${site.id}/archive`).expect(200);
      await a().post(`/companies/${company.id}/archive`).expect(200);
    });

    it('nothing can be created under, or restored into, an archived parent', async () => {
      const company = await newCompany(a(), 'DEAD-CO');
      const site = await newSite(a(), company.id, 'DEAD-SITE');
      const department = await newDepartment(a(), site.id, 'Dead department');
      await a().post(`/departments/${department.id}/archive`).expect(200);
      await a().post(`/sites/${site.id}/archive`).expect(200);
      await a().post(`/companies/${company.id}/archive`).expect(200);

      const cases: [string, object][] = [
        ['/sites', { companyId: company.id, code: 'LATE', name: 'Late site', ...SITE }],
        ['/departments', { siteId: site.id, name: 'Late department' }],
        [`/sites/${site.id}/restore`, {}],
        [`/departments/${department.id}/restore`, {}],
      ];
      for (const [url, body] of cases) {
        const response = await a().post(url, body).expect(409);
        expect(response.body.details).toEqual({ reason: 'parent_archived' });
      }

      // Restoring from the top works.
      await a().post(`/companies/${company.id}/restore`).expect(200);
      await a().post(`/sites/${site.id}/restore`).expect(200);
      await a().post(`/departments/${department.id}/restore`).expect(200);
    });

    it('exposes no physical deletion at all', async () => {
      const company = await newCompany(a(), 'KEEP-CO');
      for (const url of [
        `/companies/${company.id}`,
        '/companies',
        `/sites/${uuidv7()}`,
        `/departments/${uuidv7()}`,
      ]) {
        const response = await request(app.getHttpServer())
          .delete(`/api/v1${url}`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect([url, response.status]).toEqual([url, 404]);
      }
      await a().get(`/companies/${company.id}`).expect(200);
    });
  });
});
