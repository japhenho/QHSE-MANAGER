import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV, type Env } from '../config/index.js';
import { PrismaClient } from '../generated/prisma/client.js';

const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Prisma 7 reads the PostgreSQL schema from the adapter options, not from the
 * `?schema=` URL parameter any more: forward it so both spellings keep working.
 */
function schemaOf(databaseUrl: string): string | undefined {
  return new URL(databaseUrl).searchParams.get('schema') ?? undefined;
}

/**
 * Raw database client. It connects with the runtime role and carries NO tenant: on
 * tenant-scoped tables it sees zero rows (Row-Level Security fails closed).
 * Business code must never inject it — use `TenantDatabase` from the tenancy module.
 * An architecture test enforces this.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg(
        {
          connectionString: env.DATABASE_URL,
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
          max: env.DATABASE_POOL_MAX,
        },
        { schema: schemaOf(env.DATABASE_URL) },
      ),
    });
  }

  /**
   * Connects eagerly so that a bad configuration shows up in the logs at startup.
   * A database that is down must not crash the process: the pool reconnects on
   * demand and the readiness probe reports the outage in the meantime.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      // The driver error may embed connection parameters: do not log it.
      this.logger.warn('Database unreachable at startup; connections will be retried on demand');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheapest possible round trip, used by the readiness probe. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
