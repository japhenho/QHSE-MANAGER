import { Injectable } from '@nestjs/common';
import { requireTenantContext, type TenantTransaction, uuidv7 } from '../tenancy/index.js';
import { type AuditEntry, auditEntrySchema, isIpAddress } from './audit-entry.js';

const MAX_USER_AGENT_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 100;

export class AuditEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditEntryError';
  }
}

/**
 * Writes the append-only audit log (ADR 0005). The only code allowed to know its shape.
 *
 * `record` takes the transaction of the business change it describes, so both are
 * committed or rolled back together: no change without a trace, no trace without a change.
 * It never swallows an error — if the event cannot be written, the caller's unit of work fails.
 */
@Injectable()
export class AuditService {
  async record(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    const parsed = auditEntrySchema.safeParse(entry);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`)
        .join('; ');
      throw new AuditEntryError(`Invalid audit entry (${problems})`);
    }
    const { action, resource, transition, metadata, actor } = parsed.data;

    const context = requireTenantContext();
    if (context.userId === undefined && actor !== 'system') {
      throw new AuditEntryError(
        'An audit event needs an actor: no user in the context and actor is not "system"',
      );
    }
    if (context.userId !== undefined && actor === 'system') {
      throw new AuditEntryError(
        'A user is in the context: the event cannot be attributed to the system',
      );
    }

    const origin = context.request;
    await tx.auditEvent.create({
      data: {
        id: uuidv7(),
        // Overwritten by the tenant client and checked by Row-Level Security.
        tenantId: context.tenantId,
        actorType: context.userId === undefined ? 'SYSTEM' : 'USER',
        actorUserId: context.userId ?? null,
        action,
        resourceType: resource?.type ?? null,
        resourceId: resource?.id ?? null,
        fromStatus: transition?.from ?? null,
        toStatus: transition?.to ?? null,
        reason: transition?.reason ?? null,
        metadata: metadata ?? {},
        requestId: origin?.requestId?.slice(0, MAX_REQUEST_ID_LENGTH) ?? null,
        sessionId: origin?.sessionId ?? null,
        // A malformed address must not make the business operation fail: it is dropped.
        ipAddress: origin?.ipAddress && isIpAddress(origin.ipAddress) ? origin.ipAddress : null,
        userAgent: origin?.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      },
    });
  }
}
