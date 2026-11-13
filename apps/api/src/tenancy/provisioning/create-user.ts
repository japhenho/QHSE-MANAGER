import { emailSchema, newPasswordSchema, organizationCodeSchema } from '@qhse/shared';
import type pg from 'pg';
import { z } from 'zod';
import { uuidv7 } from '../uuid.js';

const UNIQUE_VIOLATION = '23505';

export const createUserInputSchema = z.object({
  organization: organizationCodeSchema,
  email: emailSchema,
  password: newPasswordSchema,
});
export type CreateUserInput = z.input<typeof createUserInputSchema>;

export class UnknownOrganizationError extends Error {
  constructor(organization: string) {
    super(`No tenant with organisation code "${organization}"`);
    this.name = 'UnknownOrganizationError';
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A user with e-mail "${email}" already exists in this tenant`);
    this.name = 'UserAlreadyExistsError';
  }
}

/**
 * Creates a user able to log in. Server-side administration only, with a connection of
 * the OWNER role (used for the first administrator of a tenant, until user management
 * exists in the application).
 */
export async function createUser(
  client: Pick<pg.ClientBase, 'query'>,
  input: CreateUserInput,
  hashPassword: (password: string) => Promise<string>,
): Promise<{ id: string; tenantId: string; email: string }> {
  const { organization, email, password } = createUserInputSchema.parse(input);

  const tenant = await client.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [
    organization,
  ]);
  const tenantId = tenant.rows[0]?.id;
  if (tenantId === undefined) throw new UnknownOrganizationError(organization);

  const id = uuidv7();
  const passwordHash = await hashPassword(password);

  await client.query('BEGIN');
  try {
    // Row-Level Security is forced on users: even the owner must bind the tenant.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      'INSERT INTO users (id, tenant_id, email, password_hash) VALUES ($1, $2, $3, $4)',
      [id, tenantId, email, passwordHash],
    );
    await client.query(
      `INSERT INTO audit_events (id, tenant_id, actor_type, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, 'SYSTEM', 'user.created', 'user', $3, '{"via":"admin-command"}')`,
      [uuidv7(), tenantId, id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === UNIQUE_VIOLATION)
      throw new UserAlreadyExistsError(email);
    throw error;
  }
  return { id, tenantId, email };
}
