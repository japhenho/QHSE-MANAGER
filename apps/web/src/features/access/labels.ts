import type { AccessErrorReason, PermissionKey } from '@qhse/shared';
import type { TFunction } from 'i18next';
import { isApiRequestError } from '../../lib/api';
import { describeError } from '../../lib/errors';

/** Translation key of every permission. Adding a permission without a label is a compile error. */
export const PERMISSION_LABELS = {
  'role:read': 'access.permissions.role_read',
  'role:manage': 'access.permissions.role_manage',
  'role:assign': 'access.permissions.role_assign',
  'user:read': 'access.permissions.user_read',
  'audit-log:read': 'access.permissions.audit_log_read',
} as const satisfies Record<PermissionKey, string>;

export const GROUP_LABELS = {
  role: 'access.groups.role',
  user: 'access.groups.user',
  'audit-log': 'access.groups.audit_log',
} as const;

const REFERENCE_ROLE_LABELS = {
  administrator: 'access.referenceRoles.administrator',
  'qhse-manager': 'access.referenceRoles.qhse_manager',
  auditor: 'access.referenceRoles.auditor',
} as const;

const REASON_LABELS = {
  missing_permissions: 'access.errors.missing_permissions',
  system_role: 'access.errors.system_role',
  stale_version: 'access.errors.stale_version',
  role_in_use: 'access.errors.role_in_use',
  self_assignment: 'access.errors.self_assignment',
  last_administrator: 'access.errors.last_administrator',
  role_name_taken: 'access.errors.role_name_taken',
} as const satisfies Record<AccessErrorReason, string>;

/** Reference roles are shown in the user's language; roles created by the tenant keep their name. */
export function roleLabel(
  role: { name: string; referenceKey: string | null },
  t: TFunction,
): string {
  const key = role.referenceKey as keyof typeof REFERENCE_ROLE_LABELS | null;
  return key && key in REFERENCE_ROLE_LABELS ? t(REFERENCE_ROLE_LABELS[key]) : role.name;
}

/** Translated explanation of a failed access-management request. */
export function describeAccessError(error: unknown, t: TFunction): string {
  if (isApiRequestError(error) && error.kind === 'http') {
    const reason = (error.apiError?.details as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === 'string' && reason in REASON_LABELS) {
      return t(REASON_LABELS[reason as AccessErrorReason]);
    }
    if (error.status === 403) return t('access.errors.forbidden');
    if (error.status === 404) return t('access.errors.notFound');
    if (error.status !== undefined && error.status >= 500) return t('errors.server');
    return t('errors.client');
  }
  return describeError(error, t);
}
