import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Finds a tenant from its organisation code BEFORE authentication, when no tenant
 * context exists yet. It goes through the `app_resolve_tenant_id` database function,
 * the only opening in the registry policy: an exact code in, one id of an ACTIVE tenant
 * out. The result identifies where credentials must be checked; it grants nothing.
 */
@Injectable()
export class TenantResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActiveTenantId(organizationCode: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string | null }[]>`
      SELECT app_resolve_tenant_id(${organizationCode}) AS id`;
    return rows[0]?.id ?? null;
  }
}
