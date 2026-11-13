import type pg from 'pg';
import { createAppClient, createOwnerClient, resetDatabase } from './support/db.js';

const PERMISSION_DENIED = '42501';
const PROBE_TABLE = 'harness_probe';

async function sqlState(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/**
 * The whole tenant-isolation strategy relies on Row-Level Security, which PostgreSQL
 * does not apply to superusers, BYPASSRLS roles or table owners. These tests prove the
 * API connects with a role that is none of those and cannot change the schema.
 */
describe('database roles', () => {
  let app: pg.Client;
  let owner: pg.Client;

  beforeAll(async () => {
    app = createAppClient();
    owner = createOwnerClient();
    await Promise.all([app.connect(), owner.connect()]);
    await owner.query(`DROP TABLE IF EXISTS public.${PROBE_TABLE}`);
    await owner.query(`CREATE TABLE public.${PROBE_TABLE} (id integer PRIMARY KEY, label text)`);
  });

  afterAll(async () => {
    await owner.query(`DROP TABLE IF EXISTS public.${PROBE_TABLE}`);
    await Promise.all([app.end(), owner.end()]);
  });

  it('runtime and owner are two distinct roles', async () => {
    const [appRole, ownerRole] = await Promise.all([
      app.query<{ name: string }>('SELECT current_user AS name'),
      owner.query<{ name: string }>('SELECT current_user AS name'),
    ]);
    expect(appRole.rows[0]?.name).toBeDefined();
    expect(appRole.rows[0]?.name).not.toBe(ownerRole.rows[0]?.name);
  });

  it('runtime role has no attribute that would bypass Row-Level Security', async () => {
    const { rows } = await app.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
         FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
      },
    ]);
  });

  it('owner role is not a superuser and cannot bypass Row-Level Security either', async () => {
    const { rows } = await owner.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it('runtime role owns nothing: no table, no sequence, no schema, not the database', async () => {
    const { rows } = await app.query<{ relations: string; schemas: string; databases: string }>(
      `SELECT
         (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
           WHERE r.rolname = current_user) AS relations,
         (SELECT count(*) FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
           WHERE r.rolname = current_user) AS schemas,
         (SELECT count(*) FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
           WHERE r.rolname = current_user) AS databases`,
    );
    expect(rows).toEqual([{ relations: '0', schemas: '0', databases: '0' }]);
  });

  it('runtime role is not a member of the owner role', async () => {
    const { rows } = await app.query<{ member: boolean }>(
      `SELECT pg_has_role(current_user, tableowner, 'MEMBER') AS member
         FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
      [PROBE_TABLE],
    );
    expect(rows).toEqual([{ member: false }]);
  });

  it.each([
    ['CREATE TABLE', 'CREATE TABLE public.forbidden_table (id integer)'],
    ['CREATE TEMP TABLE', 'CREATE TEMP TABLE forbidden_temp (id integer)'],
    ['CREATE SCHEMA', 'CREATE SCHEMA forbidden_schema'],
    ['ALTER TABLE', `ALTER TABLE public.${PROBE_TABLE} ADD COLUMN extra text`],
    ['DROP TABLE', `DROP TABLE public.${PROBE_TABLE}`],
    ['TRUNCATE', `TRUNCATE TABLE public.${PROBE_TABLE}`],
    ['DISABLE ROW LEVEL SECURITY', `ALTER TABLE public.${PROBE_TABLE} DISABLE ROW LEVEL SECURITY`],
    ['CREATE POLICY', `CREATE POLICY p ON public.${PROBE_TABLE} USING (true)`],
  ])('runtime role cannot run %s', async (_label, statement) => {
    expect(await sqlState(() => app.query(statement))).toBe(PERMISSION_DENIED);
  });

  it('runtime role can read and write rows of tables created by the owner', async () => {
    await app.query(`INSERT INTO public.${PROBE_TABLE} (id, label) VALUES (1, 'a')`);
    await app.query(`UPDATE public.${PROBE_TABLE} SET label = 'b' WHERE id = 1`);
    const { rows } = await app.query(`SELECT id, label FROM public.${PROBE_TABLE}`);
    expect(rows).toEqual([{ id: 1, label: 'b' }]);
  });

  it('resetDatabase empties application tables and keeps the schema', async () => {
    await owner.query(
      `INSERT INTO public.${PROBE_TABLE} (id, label) VALUES (2, 'x') ON CONFLICT DO NOTHING`,
    );

    await resetDatabase();

    const { rows } = await app.query<{ count: string }>(
      `SELECT count(*) AS count FROM public.${PROBE_TABLE}`,
    );
    expect(rows).toEqual([{ count: '0' }]);
  });
});
