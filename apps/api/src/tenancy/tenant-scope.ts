import type { Prisma } from '../generated/prisma/client.js';

/**
 * Barrier 1 of tenant isolation (ADR 0002): every query issued through the tenant
 * client is rewritten so that it can only read, change or create rows of the current
 * tenant, whatever the caller passed. Row-Level Security is the independent barrier 2.
 *
 * Known limit: nested relation filters and nested writes are not rewritten here; they
 * are covered by Row-Level Security and by composite foreign keys.
 */
export interface ScopeRule {
  /** Field holding the tenant id on this model. */
  readonly tenantField: string;
  /** Relation that could be used to re-attach a row to another tenant. */
  readonly tenantRelation?: string;
  /** False for models the API may read but never write (the tenant registry). */
  readonly writable: boolean;
  /** True for journals: rows can be created and read, never changed nor deleted. */
  readonly appendOnly?: boolean;
}

/**
 * One rule per model. The `Record<Prisma.ModelName, …>` type makes the build fail when a
 * new model is added without declaring how it is scoped.
 */
export const TENANT_SCOPE: Readonly<Record<Prisma.ModelName, ScopeRule>> = {
  Tenant: { tenantField: 'id', writable: false },
  User: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  AuthSession: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  RefreshToken: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  LoginThrottle: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  Role: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  RolePermission: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  RoleAssignment: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  Company: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  Site: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  Department: { tenantField: 'tenantId', tenantRelation: 'tenant', writable: true },
  AuditEvent: {
    tenantField: 'tenantId',
    tenantRelation: 'tenant',
    writable: true,
    appendOnly: true,
  },
};

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

type Args = Record<string, unknown>;

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const FILTERED_WRITE_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Adds the tenant condition with AND, so a caller-supplied filter can never widen it. */
function scopeWhere(where: unknown, rule: ScopeRule, tenantId: string): Args {
  const base = isRecord(where) ? where : {};
  const existing = base['AND'];
  const and = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  return { ...base, AND: [...and, { [rule.tenantField]: tenantId }] };
}

/** Forces the tenant on a row being created, replacing anything the caller provided. */
function scopeCreateData(data: unknown, rule: ScopeRule, tenantId: string): Args {
  if (!isRecord(data)) throw new TenantScopeError('Create data must be an object');
  const scoped: Args = { ...data };
  if (rule.tenantRelation) delete scoped[rule.tenantRelation];
  scoped[rule.tenantField] = tenantId;
  return scoped;
}

/** A row never changes tenant: any attempt to set it in an update is dropped. */
function scopeUpdateData(data: unknown, rule: ScopeRule): unknown {
  if (!isRecord(data)) return data;
  const scoped: Args = { ...data };
  delete scoped[rule.tenantField];
  if (rule.tenantRelation) delete scoped[rule.tenantRelation];
  return scoped;
}

/**
 * Returns the arguments to actually send to the database for `model.operation`.
 * Unknown operations are refused: a new Prisma operation must be reviewed before use.
 */
export function scopeArgs(
  model: Prisma.ModelName,
  operation: string,
  args: unknown,
  tenantId: string,
): Args {
  const rule = TENANT_SCOPE[model];
  const input: Args = isRecord(args) ? args : {};

  if (READ_OPERATIONS.has(operation)) {
    return { ...input, where: scopeWhere(input['where'], rule, tenantId) };
  }

  if (!rule.writable) {
    throw new TenantScopeError(`${model} is read-only through the tenant client (${operation})`);
  }

  if (rule.appendOnly && !CREATE_OPERATIONS.has(operation)) {
    throw new TenantScopeError(`${model} is append-only (${operation})`);
  }

  if (FILTERED_WRITE_OPERATIONS.has(operation)) {
    const scoped: Args = { ...input, where: scopeWhere(input['where'], rule, tenantId) };
    if ('data' in input) scoped['data'] = scopeUpdateData(input['data'], rule);
    return scoped;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const data = input['data'];
    return {
      ...input,
      data: Array.isArray(data)
        ? data.map((row) => scopeCreateData(row, rule, tenantId))
        : scopeCreateData(data, rule, tenantId),
    };
  }

  if (operation === 'upsert') {
    return {
      ...input,
      where: scopeWhere(input['where'], rule, tenantId),
      create: scopeCreateData(input['create'], rule, tenantId),
      update: scopeUpdateData(input['update'], rule),
    };
  }

  throw new TenantScopeError(`Operation ${model}.${operation} is not allowed on the tenant client`);
}
