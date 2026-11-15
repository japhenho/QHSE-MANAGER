import { z } from 'zod';
import { paginationQuerySchema } from './pagination';
import { permissionKeySchema, type PermissionKey } from './permissions';

const roleName = z.string().trim().min(2).max(80);
const roleDescription = z.string().trim().max(500);
const permissionList = z
  .array(permissionKeySchema)
  .max(200)
  .transform((keys) => [...new Set(keys)].sort());

export const createRoleSchema = z.strictObject({
  name: roleName,
  description: roleDescription.optional(),
  permissions: permissionList,
});
export type CreateRoleRequest = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .strictObject({
    name: roleName.optional(),
    description: roleDescription.nullable().optional(),
    permissions: permissionList.optional(),
    /** Version the client read; a mismatch means someone else changed the role. */
    version: z.number().int().min(1),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.permissions !== undefined,
    {
      message: 'Nothing to change',
    },
  );
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

export const uuidParamSchema = z.uuid();

/**
 * Where a role applies. A scope covers what it contains: a company covers its sites and
 * their departments, a site covers its departments, the tenant covers everything.
 */
export const ACCESS_SCOPE_TYPES = ['tenant', 'company', 'site', 'department'] as const;
export type AccessScopeType = (typeof ACCESS_SCOPE_TYPES)[number];

export const assignRoleSchema = z
  .strictObject({
    roleId: z.uuid(),
    scopeType: z.enum(ACCESS_SCOPE_TYPES).default('tenant'),
    /** Company, site or department the role applies to; absent for the whole tenant. */
    scopeId: z.uuid().optional(),
  })
  .refine((value) => (value.scopeType === 'tenant') === (value.scopeId === undefined), {
    message: 'scopeId is required for a company, site or department scope, and only then',
    path: ['scopeId'],
  });
export type AssignRoleRequest = z.infer<typeof assignRoleSchema>;

/** Stable reasons carried in `details.reason` of access-management errors. */
export const ACCESS_ERROR_REASONS = [
  'missing_permissions',
  'system_role',
  'stale_version',
  'role_in_use',
  'self_assignment',
  'last_administrator',
  'role_name_taken',
  'outside_scope',
] as const;
export type AccessErrorReason = (typeof ACCESS_ERROR_REASONS)[number];

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  referenceKey: string | null;
  /** The administrator role: every permission, cannot be changed nor deleted. */
  isSystem: boolean;
  permissions: PermissionKey[];
  assignedUserCount: number;
  version: number;
}

export interface UserRoleRef {
  id: string;
  name: string;
  referenceKey: string | null;
  isSystem: boolean;
}

/** A role given to a user on a scope. */
export interface RoleAssignmentView {
  id: string;
  role: UserRoleRef;
  scopeType: AccessScopeType;
  /** Null for the whole tenant. */
  scopeId: string | null;
  /** Name of the company, site or department; null for the whole tenant. */
  scopeName: string | null;
}

export interface UserSummary {
  id: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  assignments: RoleAssignmentView[];
}

export const userListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

const isoDate = z.iso.datetime({ offset: true });

export const auditEventQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorUserId: z.uuid().optional(),
  resourceType: z.string().trim().max(60).optional(),
  resourceId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>;

export interface AuditEventView {
  id: string;
  /** Server time, ISO 8601 UTC. */
  occurredAt: string;
  actorType: 'USER' | 'SYSTEM';
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
}
