import { describe, expect, it } from 'vitest';
import {
  isPermissionKey,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  REFERENCE_ROLES,
} from './permissions';
import { createRoleSchema, updateRoleSchema } from './rbac';

describe('permission catalogue', () => {
  it('uses resource:action keys, without duplicates', () => {
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('shows every permission exactly once in the editor groups', () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect([...grouped].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('recognises catalogue keys only', () => {
    expect(isPermissionKey('role:manage')).toBe(true);
    expect(isPermissionKey('role:destroy')).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });
});

describe('reference roles', () => {
  it('has exactly one system role, the administrator, holding every permission', () => {
    const system = REFERENCE_ROLES.filter((role) => role.isSystem);
    expect(system.map((role) => role.key)).toEqual(['administrator']);
    expect([...(system[0]?.permissions ?? [])].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('only references catalogue permissions', () => {
    for (const role of REFERENCE_ROLES) {
      for (const permission of role.permissions) expect(isPermissionKey(permission)).toBe(true);
    }
  });
});

describe('role schemas', () => {
  it('normalises a new role: trimmed name, unique sorted permissions', () => {
    expect(
      createRoleSchema.parse({
        name: '  Chef de quart ',
        permissions: ['user:read', 'role:read', 'user:read'],
      }),
    ).toEqual({ name: 'Chef de quart', permissions: ['role:read', 'user:read'] });
  });

  it.each([
    { name: 'x', permissions: [] },
    { name: 'Valid', permissions: ['not:a-permission'] },
    { name: 'Valid', permissions: [], isSystem: true },
    { name: 'Valid', permissions: [], tenantId: '0193a000-0000-7000-8000-000000000000' },
  ])('rejects %j', (input) => {
    expect(createRoleSchema.safeParse(input).success).toBe(false);
  });

  it('an update needs the version and at least one change', () => {
    expect(updateRoleSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateRoleSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(updateRoleSchema.safeParse({ name: 'New name', version: 2 }).success).toBe(true);
  });
});

describe('assignRoleSchema', () => {
  const roleId = '0193a000-0000-7000-8000-000000000001';
  const scopeId = '0193a000-0000-7000-8000-000000000002';

  it('defaults to the whole tenant', async () => {
    const { assignRoleSchema } = await import('./rbac');
    expect(assignRoleSchema.parse({ roleId })).toEqual({ roleId, scopeType: 'tenant' });
    expect(assignRoleSchema.parse({ roleId, scopeType: 'site', scopeId })).toEqual({
      roleId,
      scopeType: 'site',
      scopeId,
    });
  });

  it.each([
    { roleId, scopeType: 'site' },
    { roleId, scopeType: 'tenant', scopeId },
    { roleId, scopeType: 'project', scopeId },
    { roleId, scopeType: 'site', scopeId: 'nope' },
    { roleId, scopeType: 'site', scopeId, userId: scopeId },
  ])('rejects %j', async (input) => {
    const { assignRoleSchema } = await import('./rbac');
    expect(assignRoleSchema.safeParse(input).success).toBe(false);
  });
});
