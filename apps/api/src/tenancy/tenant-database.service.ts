import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenantContext } from './tenant-context.js';
import { scopeArgs } from './tenant-scope.js';

/** Wraps a raw client so every model operation goes through barrier 1. */
function withTenantScope(prisma: PrismaService) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const { tenantId } = requireTenantContext();
          const scoped = scopeArgs(model as Prisma.ModelName, operation, args, tenantId);
          return query(scoped as typeof args);
        },
      },
    },
  });
}

type ScopedClient = ReturnType<typeof withTenantScope>;

/** Database handle available inside {@link TenantDatabase.run}. */
export type TenantTransaction = Parameters<Parameters<ScopedClient['$transaction']>[0]>[0];

export interface TenantRunOptions {
  /** Maximum duration of the unit of work, in milliseconds (default 5000). */
  readonly timeoutMs?: number;
}

/**
 * The ONLY entry point to tenant data for business code (ADR 0002).
 *
 * `run()` executes one unit of work for the tenant of the current context, inside one
 * database transaction:
 *   - barrier 2: the tenant is bound to that transaction (`set_config(..., true)`), so
 *     Row-Level Security applies and the binding disappears at COMMIT/ROLLBACK — it can
 *     never be inherited by the next user of the pooled connection;
 *   - barrier 1: every model operation of the handle is rewritten by `scopeArgs`.
 * The unit of work is atomic: if `fn` throws, everything it wrote is rolled back.
 *
 * Keep units of work short and never await slow external calls inside one: a pooled
 * connection is held until it ends.
 */
@Injectable()
export class TenantDatabase {
  private readonly scoped: ScopedClient;

  constructor(prisma: PrismaService) {
    this.scoped = withTenantScope(prisma);
  }

  async run<T>(
    fn: (db: TenantTransaction) => Promise<T>,
    options: TenantRunOptions = {},
  ): Promise<T> {
    const { tenantId } = requireTenantContext();
    return this.scoped.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      options.timeoutMs === undefined ? undefined : { timeout: options.timeoutMs },
    );
  }
}
