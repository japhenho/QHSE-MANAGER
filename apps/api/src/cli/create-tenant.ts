/**
 * Administration command: creates a tenant (decision D-13).
 *
 *   pnpm --filter @qhse/api tenant:create --slug acme-congo --name "ACME Congo"
 *
 * Runs on the server with the OWNER database role (MIGRATION_DATABASE_URL). There is no
 * HTTP endpoint for this. Prints the created tenant as one JSON line on stdout.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { z } from 'zod';
import { loadEnvFiles } from '../config/index.js';
import { createTenant, TenantAlreadyExistsError } from '../tenancy/provisioning/create-tenant.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { slug: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  });

  loadEnvFiles();
  const connectionString = process.env['MIGRATION_DATABASE_URL'];
  if (!connectionString) {
    console.error('MIGRATION_DATABASE_URL is required (owner role).');
    return 2;
  }

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const tenant = await createTenant(client, { slug: values.slug ?? '', name: values.name ?? '' });
    console.log(JSON.stringify(tenant));
    return 0;
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        console.error(`--${issue.path.join('.')}: ${issue.message}`);
      }
      return 2;
    }
    if (error instanceof TenantAlreadyExistsError) {
      console.error(error.message);
      return 1;
    }
    // Driver errors may embed connection parameters: print the kind of failure only.
    const code =
      (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'unknown');
    console.error(`Tenant creation failed (${code}).`);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error');
  return 2;
});
