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

/**
 * Empties every application table (identity sequences included) so that each test
 * starts from a known state. The schema and the migration history are kept.
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
    const tables = rows.map((row) => `public.${pg.escapeIdentifier(row.tablename)}`).join(', ');
    await owner.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await owner.end();
  }
}
