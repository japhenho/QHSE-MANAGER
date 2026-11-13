// Shared by the Jest global setup and the per-file setup (plain JS: both run outside ts-jest).
import path from 'node:path';

const API_ROOT = path.join(import.meta.dirname, '..', '..');

/**
 * Resolves the two connection URLs of the integration-test database and points the
 * application at it. Integration tests truncate tables: they must never run against a
 * development or production database, hence the dedicated variables and the name check.
 */
export function resolveTestDatabase() {
  for (const file of [path.join(API_ROOT, '.env'), path.join(API_ROOT, '..', '..', '.env')]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing .env files are expected (CI, fresh clone).
    }
  }

  const appUrl = process.env.TEST_DATABASE_URL;
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!appUrl || !ownerUrl) {
    throw new Error(
      'Integration tests need TEST_DATABASE_URL (runtime role) and TEST_MIGRATION_DATABASE_URL ' +
        '(owner role). See README, section "Tests d\'intégration".',
    );
  }
  for (const [name, value] of [
    ['TEST_DATABASE_URL', appUrl],
    ['TEST_MIGRATION_DATABASE_URL', ownerUrl],
  ]) {
    const database = new URL(value).pathname.slice(1);
    if (!database.endsWith('_test')) {
      throw new Error(`${name} must target a database whose name ends with "_test".`);
    }
  }

  // The application under test only ever sees the runtime role.
  process.env.DATABASE_URL = appUrl;
  process.env.MIGRATION_DATABASE_URL = ownerUrl;
  process.env.NODE_ENV = 'test';
  return { appUrl, ownerUrl, apiRoot: API_ROOT };
}
