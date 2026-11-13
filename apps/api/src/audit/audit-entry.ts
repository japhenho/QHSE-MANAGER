import { isIP } from 'node:net';
import { z } from 'zod';

/** Stable action key: `<domain>.<event>` in lower case, e.g. `incident.status_changed`. */
const ACTION_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_]*)+$/;

/** Metadata keys that must never be stored: the audit log is widely readable and kept long. */
const FORBIDDEN_METADATA_KEY =
  /pass(word|phrase)?|secret|token|authorization|cookie|api[-_]?key|otp|mfa[-_]?code/i;
const MAX_METADATA_BYTES = 8 * 1024;

function findForbiddenKey(value: unknown, path = ''): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenKey(item, `${path}[${String(index)}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  for (const [key, nested] of Object.entries(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_METADATA_KEY.test(key)) return keyPath;
    const found = findForbiddenKey(nested, keyPath);
    if (found) return found;
  }
  return undefined;
}

const status = z.string().trim().min(1).max(60);

const metadataSchema = z.record(z.string(), z.json()).superRefine((metadata, ctx) => {
  const forbidden = findForbiddenKey(metadata);
  if (forbidden) {
    ctx.addIssue({ code: 'custom', message: `must not contain the sensitive key "${forbidden}"` });
  }
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_METADATA_BYTES) {
    ctx.addIssue({
      code: 'custom',
      message: `must not exceed ${String(MAX_METADATA_BYTES)} bytes`,
    });
  }
});

export const auditEntrySchema = z.strictObject({
  action: z.string().max(100).regex(ACTION_PATTERN, 'must look like "domain.event"'),
  resource: z.strictObject({ type: z.string().trim().min(1).max(60), id: z.uuid() }).optional(),
  /** A state transition: previous and new status are both mandatory. */
  transition: z
    .strictObject({
      from: status,
      to: status,
      reason: z.string().trim().min(1).max(2000).optional(),
    })
    .optional(),
  metadata: metadataSchema.optional(),
  /**
   * Must be set to "system" to record an event when no user is in the context
   * (scheduled work, provisioning). There is no anonymous event.
   */
  actor: z.literal('system').optional(),
});

/** What a business module hands to the audit service. Time and tenant are never inputs. */
export type AuditEntry = z.input<typeof auditEntrySchema>;

export function isIpAddress(value: string): boolean {
  return isIP(value) !== 0;
}
