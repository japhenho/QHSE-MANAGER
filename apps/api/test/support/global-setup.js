// Runs once before the integration tests: the database must be reachable and migrated.
// Any failure here aborts the whole run — a missing database never skips tests silently.
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { resolveTestDatabase } from './test-env.js';

export default async function globalSetup() {
  const { ownerUrl, apiRoot } = resolveTestDatabase();

  const client = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    const reason = error instanceof Error ? (error.code ?? error.name) : 'unknown';
    throw new Error(
      `Integration test database unreachable with the owner role (${reason}). ` +
        'Start PostgreSQL and run the database init script first (see README).',
      { cause: error },
    );
  } finally {
    await client.end().catch(() => undefined);
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
