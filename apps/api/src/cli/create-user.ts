/**
 * Administration command: creates a user able to log in (first administrator of a tenant).
 *
 *   printf '%s' "$PASSWORD" | pnpm user:create --organization acme-congo --email admin@acme.example --administrator
 *
 * `--administrator` gives the administrator role (every right, including creating the
 * roles of each job position). Without it the user has no role and can do nothing
 * until an administrator assigns one.
 *
 * The password is read from standard input, never from the command line: arguments
 * end up in the shell history and in the process list. Runs with the OWNER database
 * role (MIGRATION_DATABASE_URL). Prints the created user as one JSON line (no password).
 */
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { z } from 'zod';
import { hashPassword } from '../auth/password.service.js';
import { loadEnvFiles } from '../config/index.js';
import {
  createUser,
  UnknownOrganizationError,
  UserAlreadyExistsError,
} from '../tenancy/provisioning/create-user.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      organization: { type: 'string' },
      email: { type: 'string' },
      administrator: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (process.stdin.isTTY) {
    console.error('Provide the password on standard input (see the header of this command).');
    return 2;
  }
  const password = (await text(process.stdin)).replace(/\r?\n$/, '');

  loadEnvFiles();
  const connectionString = process.env['MIGRATION_DATABASE_URL'];
  if (!connectionString) {
    console.error('MIGRATION_DATABASE_URL is required (owner role).');
    return 2;
  }

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const user = await createUser(
      client,
      {
        organization: values.organization ?? '',
        email: values.email ?? '',
        password,
        administrator: values.administrator,
      },
      hashPassword,
    );
    console.log(JSON.stringify(user));
    return 0;
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        // The message names the rule only; the received value is never printed.
        console.error(`${issue.path.join('.')}: ${issue.message}`);
      }
      return 2;
    }
    if (error instanceof UnknownOrganizationError || error instanceof UserAlreadyExistsError) {
      console.error(error.message);
      return 1;
    }
    const code =
      (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'unknown');
    console.error(`User creation failed (${code}).`);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error');
  return 2;
});
