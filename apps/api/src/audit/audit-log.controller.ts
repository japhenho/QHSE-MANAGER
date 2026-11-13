import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuditEventQuery,
  auditEventQuerySchema,
  type AuditEventView,
  type Paginated,
  PERMISSIONS,
} from '@qhse/shared';
import { RequirePermission } from '../auth/access.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { TenantDatabase } from '../tenancy/index.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit-log')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditLogController {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_LOG_READ)
  @ApiOperation({ summary: 'Read the audit log of the tenant, most recent first' })
  list(
    @Query(new ZodValidationPipe(auditEventQuerySchema)) query: AuditEventQuery,
  ): Promise<Paginated<AuditEventView>> {
    const { page, pageSize, ...filters } = query;
    const where = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
      ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
      ...(filters.from || filters.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    return this.db.run(async (tx) => {
      const [events, total] = [
        await tx.auditEvent.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { actor: { select: { email: true } } },
        }),
        await tx.auditEvent.count({ where }),
      ];

      // Reading the journal is itself a traced action (ADR 0005, § 4). Recorded when a
      // consultation starts (first page), not for every page turned.
      if (page === 1) {
        await this.audit.record(tx, {
          action: 'audit_log.viewed',
          metadata: Object.fromEntries(
            Object.entries(filters).filter(([, value]) => value !== undefined),
          ),
        });
      }

      return {
        items: events.map((event) => ({
          id: event.id,
          occurredAt: event.occurredAt.toISOString(),
          actorType: event.actorType,
          actorUserId: event.actorUserId,
          actorEmail: event.actor?.email ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          reason: event.reason,
          metadata: (event.metadata ?? {}) as Record<string, unknown>,
          ipAddress: event.ipAddress,
        })),
        page,
        pageSize,
        total,
      };
    });
  }
}
