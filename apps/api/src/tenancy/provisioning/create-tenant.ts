import { REFERENCE_ROLES } from '@qhse/shared';
import type pg from 'pg';
import { z } from 'zod';
import { uuidv7 } from '../uuid.js';

const UNIQUE_VIOLATION = '23505';

export const createTenantInputSchema = z.object({
  /** Organisation code: lower-case letters, digits and single hyphens. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must contain only a-z, 0-9 and single hyphens'),
  name: z.string().trim().min(2).max(200),
});
export type CreateTenantInput = z.input<typeof createTenantInputSchema>;

export interface CreatedTenant {
  id: string;
  slug: string;
  name: string;
}

export class TenantAlreadyExistsError extends Error {
  constructor(slug: string) {
    super(`A tenant with slug "${slug}" already exists`);
    this.name = 'TenantAlreadyExistsError';
  }
}

/**
 * Creates a tenant. Must be given a connection of the OWNER role: the runtime role of
 * the API has no right to insert into the tenant registry, by design (decision D-13:
 * tenants are provisioned from the server, never through the API).
 */
export async function createTenant(
  client: Pick<pg.ClientBase, 'query'>,
  input: CreateTenantInput,
): Promise<CreatedTenant> {
  const { slug, name } = createTenantInputSchema.parse(input);
  const id = uuidv7();
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      slug,
      name,
    ]);

    // Reference roles (decision D-05). Row-Level Security is forced on these tables:
    // even the owner must bind the tenant first.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
    for (const role of REFERENCE_ROLES) {
      const roleId = uuidv7();
      await client.query(
        `INSERT INTO roles (id, tenant_id, name, description, reference_key, is_system)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roleId, id, role.name, role.description, role.key, role.isSystem],
      );
      // The administrator role stands for the whole catalogue: nothing to store.
      if (role.isSystem) continue;
      for (const permission of role.permissions) {
        await client.query(
          'INSERT INTO role_permissions (tenant_id, role_id, permission) VALUES ($1, $2, $3)',
          [id, roleId, permission],
        );
      }
    }
    await client.query(
      `INSERT INTO audit_events (id, tenant_id, actor_type, action, metadata)
       VALUES ($1, $2, 'SYSTEM', 'tenant.created', $3)`,
      [uuidv7(), id, JSON.stringify({ via: 'admin-command', slug })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new TenantAlreadyExistsError(slug);
    }
    throw error;
  }
  return { id, slug, name };
}
