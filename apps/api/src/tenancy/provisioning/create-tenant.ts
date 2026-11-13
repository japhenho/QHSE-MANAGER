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
  try {
    await client.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      slug,
      name,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new TenantAlreadyExistsError(slug);
    }
    throw error;
  }
  return { id, slug, name };
}
