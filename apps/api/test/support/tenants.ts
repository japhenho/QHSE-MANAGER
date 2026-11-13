import type pg from 'pg';
import { createTenant } from '../../src/tenancy/provisioning/create-tenant.js';
import { uuidv7 } from '../../src/tenancy/uuid.js';

/** Runs `fn` in one transaction bound to a tenant, exactly like the application does. */
export async function asTenant<T>(
  client: pg.Client,
  tenantId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (tenantId !== null) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export interface TenantFixture {
  tenantId: string;
  userIds: string[];
  emails: string[];
}

/** Creates a tenant with `userCount` users, through the owner connection. */
export async function seedTenant(
  owner: pg.Client,
  slug: string,
  userCount: number,
): Promise<TenantFixture> {
  const { id: tenantId } = await createTenant(owner, { slug, name: `Tenant ${slug} (DEMO)` });
  const userIds: string[] = [];
  const emails: string[] = [];
  await asTenant(owner, tenantId, async () => {
    for (let i = 0; i < userCount; i += 1) {
      const id = uuidv7();
      const email = `user${String(i)}@${slug}.example.test`;
      await owner.query('INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3)', [
        id,
        tenantId,
        email,
      ]);
      userIds.push(id);
      emails.push(email);
    }
  });
  return { tenantId, userIds, emails };
}

export async function sqlState(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
