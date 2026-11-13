import { isPermissionKey, PERMISSION_KEYS, type PermissionKey } from '@qhse/shared';
import type { TenantTransaction } from '../tenancy/index.js';

/**
 * Everything a user may do, computed from the roles assigned to them — never cached,
 * never stored in a token: removing a role takes effect at the next request.
 * The administrator (system) role stands for the whole catalogue, including
 * permissions added after the role was created.
 */
export async function effectivePermissions(
  tx: TenantTransaction,
  userId: string,
): Promise<ReadonlySet<PermissionKey>> {
  const assignments = await tx.roleAssignment.findMany({
    where: { userId },
    select: { role: { select: { isSystem: true, permissions: { select: { permission: true } } } } },
  });
  if (assignments.some((assignment) => assignment.role.isSystem)) return new Set(PERMISSION_KEYS);

  const granted = new Set<PermissionKey>();
  for (const assignment of assignments) {
    for (const { permission } of assignment.role.permissions) {
      // A key removed from the catalogue grants nothing, even if still stored.
      if (isPermissionKey(permission)) granted.add(permission);
    }
  }
  return granted;
}
