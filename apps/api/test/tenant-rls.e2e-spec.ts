import type pg from 'pg';
import { uuidv7 } from '../src/tenancy/uuid.js';
import { createAppClient, createOwnerClient, resetDatabase } from './support/db.js';
import { asTenant, seedTenant, sqlState, type TenantFixture } from './support/tenants.js';

const RLS_VIOLATION = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_TEXT_REPRESENTATION = '22P02';

/**
 * Barrier 2 alone: plain SQL with the runtime role, WITHOUT the application layer.
 * Whatever a bug in the application does, PostgreSQL itself must keep tenants apart.
 */
describe('tenant isolation — Row-Level Security (barrier 2, direct SQL)', () => {
  let app: pg.Client;
  let owner: pg.Client;
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    await resetDatabase();
    app = createAppClient();
    owner = createOwnerClient();
    await Promise.all([app.connect(), owner.connect()]);
    a = await seedTenant(owner, 'rls-alpha', 3);
    b = await seedTenant(owner, 'rls-bravo', 2);
  });

  afterAll(async () => {
    await Promise.all([app.end(), owner.end()]);
  });

  describe('with tenant A bound to the transaction', () => {
    it('reads only the rows of A', async () => {
      const rows = await asTenant(app, a.tenantId, async () => {
        const result = await app.query<{ id: string; tenant_id: string }>(
          'SELECT id, tenant_id FROM users ORDER BY email',
        );
        return result.rows;
      });
      expect(rows.map((row) => row.id).sort()).toEqual([...a.userIds].sort());
      expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([a.tenantId]));
    });

    it('counts only the rows of A', async () => {
      const count = await asTenant(app, a.tenantId, async () => {
        const result = await app.query<{ n: string }>('SELECT count(*) AS n FROM users');
        return result.rows[0]?.n;
      });
      expect(count).toBe('3');
    });

    it('cannot read a row of B even by its id', async () => {
      const rowCount = await asTenant(app, a.tenantId, async () => {
        const result = await app.query('SELECT 1 FROM users WHERE id = $1', [b.userIds[0]]);
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });

    it('cannot update a row of B', async () => {
      const rowCount = await asTenant(app, a.tenantId, async () => {
        const result = await app.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [
          b.userIds[0],
        ]);
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });

    it('an unfiltered UPDATE or DELETE never touches B', async () => {
      await asTenant(app, a.tenantId, async () => {
        await app.query(`UPDATE users SET version = version + 1`);
        await app.query('SAVEPOINT before_delete');
        await app.query('DELETE FROM users');
        await app.query('ROLLBACK TO SAVEPOINT before_delete');
      });
      const rowsOfB = await asTenant(owner, b.tenantId, async () => {
        const result = await owner.query<{ version: number }>('SELECT version FROM users');
        return result.rows;
      });
      expect(rowsOfB).toEqual([{ version: 1 }, { version: 1 }]);
    });

    it('cannot delete a row of B', async () => {
      const rowCount = await asTenant(app, a.tenantId, async () => {
        const result = await app.query('DELETE FROM users WHERE id = $1', [b.userIds[0]]);
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });

    it('cannot insert a row carrying the tenant id of B', async () => {
      const state = await sqlState(() =>
        asTenant(app, a.tenantId, () =>
          app.query('INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3)', [
            uuidv7(),
            b.tenantId,
            'intruder@rls-bravo.example.test',
          ]),
        ),
      );
      expect(state).toBe(RLS_VIOLATION);
    });

    it('cannot move one of its own rows to B', async () => {
      const state = await sqlState(() =>
        asTenant(app, a.tenantId, () =>
          app.query('UPDATE users SET tenant_id = $1 WHERE id = $2', [b.tenantId, a.userIds[0]]),
        ),
      );
      expect(state).toBe(RLS_VIOLATION);
    });

    it('sees only its own row in the tenant registry', async () => {
      const rows = await asTenant(app, a.tenantId, async () => {
        const result = await app.query<{ id: string }>('SELECT id FROM tenants');
        return result.rows;
      });
      expect(rows).toEqual([{ id: a.tenantId }]);
    });
  });

  describe('fail closed: no tenant bound', () => {
    it('reads zero rows', async () => {
      const result = await app.query('SELECT 1 FROM users');
      expect(result.rowCount).toBe(0);
    });

    it('reads zero tenants', async () => {
      const result = await app.query('SELECT 1 FROM tenants');
      expect(result.rowCount).toBe(0);
    });

    it('cannot insert', async () => {
      const state = await sqlState(() =>
        app.query('INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3)', [
          uuidv7(),
          a.tenantId,
          'nobody@rls-alpha.example.test',
        ]),
      );
      expect(state).toBe(RLS_VIOLATION);
    });

    it('updates and deletes nothing', async () => {
      const updated = await app.query(`UPDATE users SET status = 'DISABLED'`);
      const deleted = await app.query('DELETE FROM users');
      expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    });

    it('an empty or malformed tenant value gives no access', async () => {
      const empty = await asTenant(
        app,
        '',
        async () => (await app.query('SELECT 1 FROM users')).rowCount,
      );
      expect(empty).toBe(0);
      const malformed = await sqlState(() =>
        asTenant(app, 'not-a-uuid', () => app.query('SELECT 1 FROM users')),
      );
      expect(malformed).toBe(INVALID_TEXT_REPRESENTATION);
    });
  });

  it('the tenant binding does not survive the transaction on the same connection', async () => {
    await asTenant(app, a.tenantId, () => app.query('SELECT 1 FROM users'));

    const setting = await app.query<{ value: string | null }>(
      `SELECT current_setting('app.tenant_id', true) AS value`,
    );
    const rows = await app.query('SELECT 1 FROM users');

    expect(setting.rows[0]?.value ?? '').toBe('');
    expect(rows.rowCount).toBe(0);
  });

  it('the binding is also dropped when the transaction is rolled back', async () => {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
    await app.query('ROLLBACK');

    expect((await app.query('SELECT 1 FROM users')).rowCount).toBe(0);
  });

  describe('tenant registry', () => {
    it('the runtime role cannot create a tenant', async () => {
      const state = await sqlState(() =>
        asTenant(app, a.tenantId, () =>
          app.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
            uuidv7(),
            'rls-intruder',
            'Intruder',
          ]),
        ),
      );
      expect(state).toBe(RLS_VIOLATION);
    });

    it('the runtime role cannot modify or delete any tenant, including its own', async () => {
      const counts = await asTenant(app, a.tenantId, async () => {
        const updated = await app.query(`UPDATE tenants SET name = 'Hacked'`);
        const deleted = await app.query('DELETE FROM tenants WHERE id = $1', [b.tenantId]);
        return [updated.rowCount, deleted.rowCount];
      });
      expect(counts).toEqual([0, 0]);
    });
  });

  it('a composite foreign key refuses a reference to a row of another tenant', async () => {
    // Foreign-key checks bypass RLS in PostgreSQL: the (tenant_id, id) target is what
    // stops a row of A from pointing at a row of B. Proven here with a throwaway table.
    await owner.query(`
      CREATE TABLE fk_probe (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
      )`);
    try {
      const insert = (userId: string | undefined) =>
        owner.query('INSERT INTO fk_probe (id, tenant_id, user_id) VALUES ($1, $2, $3)', [
          uuidv7(),
          a.tenantId,
          userId,
        ]);

      expect(await sqlState(() => insert(b.userIds[0]))).toBe(FOREIGN_KEY_VIOLATION);
      expect(await sqlState(() => insert(a.userIds[0]))).toBeUndefined();
    } finally {
      await owner.query('DROP TABLE fk_probe');
    }
  });
});

/**
 * Catalogue guard (criterion CC-5): a table that has a tenant_id column but no enforced
 * isolation policy makes this test fail. A new table cannot be forgotten.
 */
describe('tenant isolation — catalogue guard', () => {
  let owner: pg.Client;

  beforeAll(async () => {
    owner = createOwnerClient();
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
  });

  const UNPROTECTED_TABLES = `
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'tenant_id' AND NOT att.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT (
         c.relrowsecurity AND c.relforcerowsecurity
         AND att.attnotnull
         AND EXISTS (
           SELECT 1 FROM pg_policy p
            WHERE p.polrelid = c.oid
              AND p.polname = 'tenant_isolation'
              AND p.polcmd = '*'
              AND p.polpermissive
              AND p.polroles = '{0}'
              AND pg_get_expr(p.polqual, p.polrelid) = '(tenant_id = app_current_tenant_id())'
              AND pg_get_expr(p.polwithcheck, p.polrelid) = '(tenant_id = app_current_tenant_id())'
         )
         AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1
       )
     ORDER BY 1`;

  it('every table with a tenant_id column has RLS enabled, forced, and the expected single policy', async () => {
    const { rows } = await owner.query(UNPROTECTED_TABLES);
    expect(rows).toEqual([]);
  });

  it('at least the users table is covered (the guard is not vacuous)', async () => {
    const { rows } = await owner.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE a.attname = 'tenant_id' AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`,
    );
    expect(rows.map((row) => row.relname)).toContain('users');
  });

  it.each([
    ['without RLS', ''],
    ['with RLS enabled but not forced', 'ALTER TABLE guard_probe ENABLE ROW LEVEL SECURITY;'],
    [
      'with a permissive extra policy',
      `ALTER TABLE guard_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE guard_probe FORCE ROW LEVEL SECURITY;
       CREATE POLICY tenant_isolation ON guard_probe USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
       CREATE POLICY open_bar ON guard_probe USING (true);`,
    ],
    [
      'with a policy that does not check writes against the tenant',
      `ALTER TABLE guard_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE guard_probe FORCE ROW LEVEL SECURITY;
       CREATE POLICY tenant_isolation ON guard_probe USING (tenant_id = app_current_tenant_id()) WITH CHECK (true);`,
    ],
  ])('detects a tenant table %s', async (_label, setup) => {
    await owner.query('CREATE TABLE guard_probe (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)');
    try {
      if (setup) await owner.query(setup);
      const { rows } = await owner.query(UNPROTECTED_TABLES);
      expect(rows).toEqual([{ table_name: 'guard_probe' }]);
    } finally {
      await owner.query('DROP TABLE guard_probe');
    }
  });
});
