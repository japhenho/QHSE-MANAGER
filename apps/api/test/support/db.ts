import pg from 'pg';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see test/support/test-env.js)`);
  return value;
}

/** Connection with the OWNER role: fixtures, cleanup and catalogue checks only. */
export function createOwnerClient(): pg.Client {
  return new pg.Client({ connectionString: requireEnv('MIGRATION_DATABASE_URL') });
}

/** Connection with the RUNTIME role, i.e. exactly what the API is allowed to do. */
export function createAppClient(): pg.Client {
  return new pg.Client({ connectionString: requireEnv('DATABASE_URL') });
}

const MIGRATIONS_TABLE = '_prisma_migrations';
/** Tables protected by "append-only" triggers, which refuse TRUNCATE even to the owner. */
const APPEND_ONLY_TABLES = ['audit_events'];

/**
 * Empties every application table (identity sequences included) so that each test
 * starts from a known state. The schema and the migration history are kept.
 *
 * Append-only tables can only be emptied by switching their triggers off, which needs
 * the owner role and a schema-level statement: exactly the limit stated in ADR 0005
 * (the application cannot do it; a database administrator can). Test databases only.
 */
export async function resetDatabase(): Promise<void> {
  const owner = createOwnerClient();
  await owner.connect();
  try {
    const { rows } = await owner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> $1`,
      [MIGRATIONS_TABLE],
    );
    if (rows.length === 0) return;
    const existing = new Set(rows.map((row) => row.tablename));
    const guarded = APPEND_ONLY_TABLES.filter((table) => existing.has(table)).map(
      (table) => `public.${pg.escapeIdentifier(table)}`,
    );
    const tables = rows.map((row) => `public.${pg.escapeIdentifier(row.tablename)}`).join(', ');

    await owner.query('BEGIN');
    try {
      for (const table of guarded) await owner.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      await owner.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
      for (const table of guarded) await owner.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  } finally {
    await owner.end();
  }
}
