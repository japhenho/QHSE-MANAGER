import { AsyncLocalStorage } from 'node:async_hooks';
import { isUuid } from './uuid.js';

/** Who a unit of work runs for. Always derived from the authenticated session. */
export interface TenantContext {
  readonly tenantId: string;
  /** Absent for system work done on behalf of a tenant (provisioning, future jobs). */
  readonly userId?: string;
  /** Where the request comes from, when there is one. Recorded in the audit log. */
  readonly request?: RequestOrigin;
}

export interface RequestOrigin {
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/** Raised when tenant data is accessed outside of a tenant context. Never caught silently. */
export class MissingTenantContextError extends Error {
  constructor() {
    super('No tenant context: tenant data cannot be accessed outside of runInTenantContext()');
    this.name = 'MissingTenantContextError';
  }
}

export class InvalidTenantContextError extends Error {
  constructor(field: string) {
    super(`Invalid tenant context: ${field} must be a UUID`);
    this.name = 'InvalidTenantContextError';
  }
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Runs `fn` for the given tenant. This is the only way to establish a tenant: there is
 * deliberately no setter, so a context can never leak into unrelated asynchronous work.
 */
export function runInTenantContext<T>(context: TenantContext, fn: () => T): T {
  if (!isUuid(context.tenantId)) throw new InvalidTenantContextError('tenantId');
  if (context.userId !== undefined && !isUuid(context.userId)) {
    throw new InvalidTenantContextError('userId');
  }
  if (context.request?.sessionId !== undefined && !isUuid(context.request.sessionId)) {
    throw new InvalidTenantContextError('request.sessionId');
  }
  const frozen: TenantContext = Object.freeze({
    ...context,
    ...(context.request ? { request: Object.freeze({ ...context.request }) } : {}),
  });
  return storage.run(frozen, fn);
}

/** The current tenant context. Throws when there is none: access fails, it never widens. */
export function requireTenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) throw new MissingTenantContextError();
  return context;
}
