import { Injectable } from '@nestjs/common';
import {
  type AccessErrorReason,
  type AccessScopeType,
  type AssignRoleRequest,
  PERMISSIONS,
  type RoleAssignmentView,
  type CreateRoleRequest,
  ERROR_CODES,
  isPermissionKey,
  type Paginated,
  type PaginationQuery,
  PERMISSION_KEYS,
  type PermissionKey,
  type RoleSummary,
  type UpdateRoleRequest,
  type UserListQuery,
  type UserSummary,
} from '@qhse/shared';
import { AuditService } from '../audit/index.js';
import type { Actor } from '../auth/access.decorators.js';
import { AppException } from '../common/errors/app.exception.js';
import type { AccessScope } from './access-scope.js';
import { TenantDatabase, type TenantTransaction, uuidv7 } from '../tenancy/index.js';

const UNIQUE_VIOLATION = 'P2002';

const notFound = (what: string) => new AppException(ERROR_CODES.NOT_FOUND, `${what} not found`);
/** `reason` is a stable key the web application translates; `message` is for developers. */
const forbidden = (reason: AccessErrorReason, message: string) =>
  new AppException(ERROR_CODES.FORBIDDEN, message, { details: { reason } });
const conflict = (reason: AccessErrorReason, message: string) =>
  new AppException(ERROR_CODES.CONFLICT, message, { details: { reason } });

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  referenceKey: string | null;
  isSystem: boolean;
  version: number;
  permissions: { permission: string }[];
  _count: { assignments: number };
}

const ROLE_INCLUDE = {
  permissions: { select: { permission: true } },
  _count: { select: { assignments: true } },
} as const;

function permissionsOf(role: Pick<RoleRow, 'isSystem' | 'permissions'>): PermissionKey[] {
  if (role.isSystem) return [...PERMISSION_KEYS].sort();
  return role.permissions
    .map((row) => row.permission)
    .filter(isPermissionKey)
    .sort();
}

function toSummary(role: RoleRow): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    referenceKey: role.referenceKey,
    isSystem: role.isSystem,
    permissions: permissionsOf(role),
    assignedUserCount: role._count.assignments,
    version: role.version,
  };
}

/**
 * Anti-escalation rule: nobody can create, change, delete, grant or withdraw a role
 * that carries a permission they do not hold themselves.
 */
function assertHoldsAll(actor: Actor, permissions: readonly PermissionKey[]): void {
  if (permissions.some((permission) => !actor.permissions.has(permission))) {
    throw forbidden(
      'missing_permissions',
      'You cannot handle a role that carries permissions you do not hold',
    );
  }
}

const SCOPE_TO_DB = {
  tenant: 'TENANT',
  company: 'COMPANY',
  site: 'SITE',
  department: 'DEPARTMENT',
} as const;
const SCOPE_FROM_DB = {
  TENANT: 'tenant',
  COMPANY: 'company',
  SITE: 'site',
  DEPARTMENT: 'department',
} as const;

/** A resolved scope, with the test telling whether an access scope covers it. */
interface ScopeTarget {
  type: AccessScopeType;
  id: string | null;
  name: string | null;
  covers(scope: AccessScope): boolean;
}

function toAssignmentView(
  assignment: { id: string },
  role: Pick<RoleRow, 'id' | 'name' | 'referenceKey' | 'isSystem'>,
  target: ScopeTarget,
): RoleAssignmentView {
  return {
    id: assignment.id,
    role: {
      id: role.id,
      name: role.name,
      referenceKey: role.referenceKey,
      isSystem: role.isSystem,
    },
    scopeType: target.type,
    scopeId: target.id,
    scopeName: target.name,
  };
}

@Injectable()
export class RbacService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ roles

  listRoles(query: PaginationQuery): Promise<Paginated<RoleSummary>> {
    return this.db.run(async (tx) => {
      const [roles, total] = [
        await tx.role.findMany({
          include: ROLE_INCLUDE,
          orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        await tx.role.count(),
      ];
      return { items: roles.map(toSummary), page: query.page, pageSize: query.pageSize, total };
    });
  }

  getRole(id: string): Promise<RoleSummary> {
    return this.db.run(async (tx) => toSummary(await this.requireRole(tx, id)));
  }

  createRole(actor: Actor, input: CreateRoleRequest): Promise<RoleSummary> {
    assertHoldsAll(actor, input.permissions);
    return this.db.run(async (tx) => {
      const id = uuidv7();
      await this.uniqueName(() =>
        tx.role.create({
          data: {
            id,
            tenantId: actor.tenantId,
            name: input.name,
            description: input.description ?? null,
          },
        }),
      );
      await this.replacePermissions(tx, actor.tenantId, id, input.permissions);
      await this.audit.record(tx, {
        action: 'role.created',
        resource: { type: 'role', id },
        metadata: { name: input.name, permissions: input.permissions },
      });
      return toSummary(await this.requireRole(tx, id));
    });
  }

  updateRole(actor: Actor, id: string, input: UpdateRoleRequest): Promise<RoleSummary> {
    return this.db.run(async (tx) => {
      const role = await this.requireRole(tx, id);
      if (role.isSystem)
        throw forbidden('system_role', 'The administrator role cannot be modified');
      const before = permissionsOf(role);
      const after = input.permissions ?? before;
      assertHoldsAll(actor, [...before, ...after]);

      // The version in the filter makes the check and the write one atomic statement.
      const { count } = await this.uniqueName(() =>
        tx.role.updateMany({
          where: { id, version: input.version },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            version: { increment: 1 },
          },
        }),
      );
      if (count === 0)
        throw conflict('stale_version', 'The role was modified by someone else; reload it');

      if (input.permissions !== undefined) {
        await this.replacePermissions(tx, actor.tenantId, id, input.permissions);
      }
      await this.audit.record(tx, {
        action: 'role.updated',
        resource: { type: 'role', id },
        metadata: {
          name: input.name ?? role.name,
          addedPermissions: after.filter((permission) => !before.includes(permission)),
          removedPermissions: before.filter((permission) => !after.includes(permission)),
        },
      });
      return toSummary(await this.requireRole(tx, id));
    });
  }

  deleteRole(actor: Actor, id: string): Promise<void> {
    return this.db.run(async (tx) => {
      const role = await this.requireRole(tx, id);
      if (role.isSystem) throw forbidden('system_role', 'The administrator role cannot be deleted');
      assertHoldsAll(actor, permissionsOf(role));
      if (role._count.assignments > 0) {
        throw conflict(
          'role_in_use',
          'The role is still assigned to users; withdraw it from them first',
        );
      }
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'role.deleted',
        resource: { type: 'role', id },
        metadata: { name: role.name, permissions: permissionsOf(role) },
      });
    });
  }

  // ------------------------------------------------------------ assignments

  /**
   * Gives a role to a user on a scope. Three limits apply to the caller:
   *  - never to themselves;
   *  - only on a scope their own `role:assign` permission covers (elsewhere the scope
   *    "does not exist" for them);
   *  - only a role whose every permission they hold on that scope.
   */
  assignRole(actor: Actor, userId: string, input: AssignRoleRequest): Promise<RoleAssignmentView> {
    if (userId === actor.userId) {
      throw forbidden('self_assignment', 'You cannot assign a role to yourself');
    }
    return this.db.run(async (tx) => {
      const role = await this.requireRole(tx, input.roleId);
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.archivedAt !== null) throw notFound('User');
      const target = await this.resolveTarget(tx, actor, input.scopeType, input.scopeId);
      this.assertHoldsAllOn(actor, permissionsOf(role), target);

      const scopeKey = target.id ?? 'tenant';
      const existing = await tx.roleAssignment.findFirst({
        where: { userId, roleId: role.id, scopeKey },
      });
      if (existing) return toAssignmentView(existing, role, target); // Idempotent.

      const created = await tx.roleAssignment.create({
        data: {
          id: uuidv7(),
          tenantId: actor.tenantId,
          userId,
          roleId: role.id,
          scopeType: SCOPE_TO_DB[input.scopeType],
          scopeKey,
          companyId: input.scopeType === 'company' ? target.id : null,
          siteId: input.scopeType === 'site' ? target.id : null,
          departmentId: input.scopeType === 'department' ? target.id : null,
          assignedBy: actor.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'role.assigned',
        resource: { type: 'user', id: userId },
        metadata: {
          roleId: role.id,
          roleName: role.name,
          scopeType: input.scopeType,
          ...(target.id ? { scopeId: target.id } : {}),
        },
      });
      return toAssignmentView(created, role, target);
    });
  }

  unassignRole(actor: Actor, userId: string, assignmentId: string): Promise<void> {
    return this.db.run(async (tx) => {
      const assignment = await tx.roleAssignment.findFirst({ where: { id: assignmentId, userId } });
      if (!assignment) throw notFound('Role assignment');
      // Lock the role: two concurrent withdrawals of the last two administrators must
      // be processed one after the other.
      await tx.$queryRaw`SELECT id FROM roles WHERE id = ${assignment.roleId}::uuid FOR UPDATE`;
      const role = await this.requireRole(tx, assignment.roleId);
      const scopeType = SCOPE_FROM_DB[assignment.scopeType];
      const scopeId = assignment.companyId ?? assignment.siteId ?? assignment.departmentId;
      let target: ScopeTarget;
      try {
        target = await this.resolveTarget(tx, actor, scopeType, scopeId ?? undefined);
      } catch {
        // Outside the caller's scope: the assignment does not exist for them.
        throw notFound('Role assignment');
      }
      this.assertHoldsAllOn(actor, permissionsOf(role), target);

      if (role.isSystem && assignment.scopeType === 'TENANT') {
        const otherActiveAdministrators = await tx.roleAssignment.count({
          where: {
            roleId: role.id,
            scopeType: 'TENANT',
            userId: { not: userId },
            user: { status: 'ACTIVE', archivedAt: null },
          },
        });
        if (otherActiveAdministrators === 0) {
          throw conflict(
            'last_administrator',
            'A tenant must keep at least one active administrator',
          );
        }
      }

      await tx.roleAssignment.deleteMany({ where: { id: assignment.id } });
      await this.audit.record(tx, {
        action: 'role.unassigned',
        resource: { type: 'user', id: userId },
        metadata: {
          roleId: role.id,
          roleName: role.name,
          scopeType,
          ...(scopeId ? { scopeId } : {}),
        },
      });
    });
  }

  // ------------------------------------------------------------------ users

  listUsers(query: UserListQuery): Promise<Paginated<UserSummary>> {
    return this.db.run(async (tx) => {
      const where = {
        archivedAt: null,
        ...(query.search ? { email: { contains: query.search.toLowerCase() } } : {}),
      };
      const [users, total] = [
        await tx.user.findMany({
          where,
          orderBy: { email: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            email: true,
            status: true,
            roleAssignments: {
              select: {
                id: true,
                scopeType: true,
                companyId: true,
                siteId: true,
                departmentId: true,
                role: { select: { id: true, name: true, referenceKey: true, isSystem: true } },
                company: { select: { name: true } },
                site: { select: { name: true } },
                department: { select: { name: true } },
              },
              orderBy: [{ role: { name: 'asc' } }, { scopeKey: 'asc' }],
            },
          },
        }),
        await tx.user.count({ where }),
      ];
      return {
        items: users.map((user) => ({
          id: user.id,
          email: user.email,
          status: user.status,
          assignments: user.roleAssignments.map((assignment) => ({
            id: assignment.id,
            role: assignment.role,
            scopeType: SCOPE_FROM_DB[assignment.scopeType],
            scopeId: assignment.companyId ?? assignment.siteId ?? assignment.departmentId,
            scopeName:
              assignment.company?.name ??
              assignment.site?.name ??
              assignment.department?.name ??
              null,
          })),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  // ---------------------------------------------------------------- helpers

  private async requireRole(tx: TenantTransaction, id: string): Promise<RoleRow> {
    const role = await tx.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    // A role of another tenant is invisible here: same answer as a role that does not exist.
    if (!role) throw notFound('Role');
    return role;
  }

  /**
   * Finds the scope an assignment is about and checks the caller may assign there.
   * A scope of another tenant, a scope that does not exist and a scope outside the
   * caller's own `role:assign` scope all give the same answer: not found.
   */
  private async resolveTarget(
    tx: TenantTransaction,
    actor: Actor,
    scopeType: AccessScopeType,
    scopeId: string | undefined,
  ): Promise<ScopeTarget> {
    const assignScope = actor.scopeOf(PERMISSIONS.ROLE_ASSIGN);
    if (scopeType === 'tenant') {
      if (!assignScope.tenantWide) throw notFound('Scope');
      return { type: 'tenant', id: null, name: null, covers: (scope) => scope.tenantWide };
    }
    if (scopeId === undefined) throw notFound('Scope');

    if (scopeType === 'company') {
      const company = await tx.company.findUnique({ where: { id: scopeId } });
      if (!company || !assignScope.coversCompany(company.id)) throw notFound('Scope');
      return {
        type: 'company',
        id: company.id,
        name: company.name,
        covers: (scope) => scope.coversCompany(company.id),
      };
    }
    if (scopeType === 'site') {
      const site = await tx.site.findUnique({ where: { id: scopeId } });
      if (!site || !assignScope.coversSite(site)) throw notFound('Scope');
      return {
        type: 'site',
        id: site.id,
        name: site.name,
        covers: (scope) => scope.coversSite(site),
      };
    }
    const department = await tx.department.findUnique({
      where: { id: scopeId },
      include: { site: { select: { companyId: true } } },
    });
    const location = department && {
      id: department.id,
      siteId: department.siteId,
      companyId: department.site.companyId,
    };
    if (!department || !location || !assignScope.coversDepartment(location))
      throw notFound('Scope');
    return {
      type: 'department',
      id: department.id,
      name: department.name,
      covers: (scope) => scope.coversDepartment(location),
    };
  }

  /** Anti-escalation on a scope: the caller holds there every permission of the role. */
  private assertHoldsAllOn(
    actor: Actor,
    permissions: readonly PermissionKey[],
    target: ScopeTarget,
  ): void {
    if (permissions.some((permission) => !target.covers(actor.scopeOf(permission)))) {
      throw forbidden(
        'missing_permissions',
        'You cannot handle a role that carries permissions you do not hold on this scope',
      );
    }
  }

  private async replacePermissions(
    tx: TenantTransaction,
    tenantId: string,
    roleId: string,
    permissions: readonly PermissionKey[],
  ): Promise<void> {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length === 0) return;
    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({ tenantId, roleId, permission })),
    });
  }

  private async uniqueName<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw conflict('role_name_taken', 'A role with this name already exists');
      }
      throw error;
    }
  }
}
