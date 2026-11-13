import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env files by itself. Load the package-level file
// first, then the monorepo root one; variables already set in the environment win.
for (const file of [
  path.join(import.meta.dirname, '.env'),
  path.join(import.meta.dirname, '../../.env'),
]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing .env files are expected (CI, production, fresh clone).
  }
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    // `prisma generate` must work without any database configured, so the URL is
    // not required here. Migration commands fail with a clear error when it is empty.
    url: process.env.DATABASE_URL ?? '',
  },
});
