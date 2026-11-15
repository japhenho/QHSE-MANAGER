import { z } from 'zod';

/**
 * Permission catalogue: the complete list of what a role can allow, as `resource:action`.
 *
 * A permission exists here only when a delivered feature checks it. Roles are data
 * (each tenant composes its own, one per job position); permissions are code.
 */
export const PERMISSIONS = {
  ROLE_READ: 'role:read',
  ROLE_MANAGE: 'role:manage',
  ROLE_ASSIGN: 'role:assign',
  USER_READ: 'user:read',
  AUDIT_LOG_READ: 'audit-log:read',
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_MANAGE: 'organization:manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_KEYS = Object.freeze(
  Object.values(PERMISSIONS),
) as readonly PermissionKey[];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}

export const permissionKeySchema = z.enum(
  PERMISSION_KEYS as unknown as [PermissionKey, ...PermissionKey[]],
);

/** Permissions grouped by resource, in display order (role editor). */
export const PERMISSION_GROUPS: readonly {
  resource: string;
  permissions: readonly PermissionKey[];
}[] = [
  {
    resource: 'role',
    permissions: [PERMISSIONS.ROLE_READ, PERMISSIONS.ROLE_MANAGE, PERMISSIONS.ROLE_ASSIGN],
  },
  { resource: 'user', permissions: [PERMISSIONS.USER_READ] },
  { resource: 'audit-log', permissions: [PERMISSIONS.AUDIT_LOG_READ] },
  {
    resource: 'organization',
    permissions: [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.ORGANIZATION_MANAGE],
  },
];

/** Stable keys of the roles installed with every tenant. */
export const REFERENCE_ROLE_KEYS = ['administrator', 'qhse-manager', 'auditor'] as const;
export type ReferenceRoleKey = (typeof REFERENCE_ROLE_KEYS)[number];

/**
 * Roles installed when a tenant is created. The administrator holds every permission,
 * present and future, and cannot be modified. The others are ordinary roles the tenant
 * may edit or delete. Names are in French (default language); the web application
 * translates them from `key`.
 */
export const REFERENCE_ROLES: readonly {
  key: ReferenceRoleKey;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: readonly PermissionKey[];
}[] = [
  {
    key: 'administrator',
    name: 'Administrateur',
    description: 'Tous les droits. Crée les rôles de chaque poste et les attribue.',
    isSystem: true,
    permissions: PERMISSION_KEYS,
  },
  {
    key: 'qhse-manager',
    name: 'Responsable QHSE',
    description: 'Consulte l’organisation, les utilisateurs, les rôles et le journal d’audit.',
    isSystem: false,
    permissions: [
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.USER_READ,
      PERMISSIONS.AUDIT_LOG_READ,
      PERMISSIONS.ORGANIZATION_READ,
    ],
  },
  {
    key: 'auditor',
    name: 'Auditeur',
    description: 'Consulte le journal d’audit.',
    isSystem: false,
    permissions: [PERMISSIONS.AUDIT_LOG_READ],
  },
];
