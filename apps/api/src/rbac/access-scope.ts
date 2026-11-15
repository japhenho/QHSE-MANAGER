import { PERMISSION_KEYS, type PermissionKey, isPermissionKey } from '@qhse/shared';
import type { TenantTransaction } from '../tenancy/index.js';

/** Minimal shape needed to tell whether a site is covered. */
export interface SiteLocation {
  id: string;
  companyId: string;
}

/** Minimal shape needed to tell whether a department is covered. */
export interface DepartmentLocation {
  id: string;
  siteId: string;
  companyId: string;
}

/**
 * Where ONE permission applies for one user: the union of the scopes of every role
 * assignment that carries it. A scope covers what it contains — the tenant covers
 * everything, a company its sites and their departments, a site its departments —
 * and never what contains it.
 *
 * This is the single place where "is this record within the caller's scope?" is
 * decided, both as a database filter (lists) and as a check (one record). Records
 * outside the scope are simply absent: the answer is the one for an unknown identifier.
 */
export class AccessScope {
  static readonly NONE = new AccessScope(false, [], [], []);
  static readonly TENANT = new AccessScope(true, [], [], []);

  private readonly companyIds: ReadonlySet<string>;
  private readonly siteIds: ReadonlySet<string>;
  private readonly departmentIds: ReadonlySet<string>;

  constructor(
    /** True when the permission is held for the whole tenant. */
    readonly tenantWide: boolean,
    companyIds: Iterable<string>,
    siteIds: Iterable<string>,
    departmentIds: Iterable<string>,
  ) {
    this.companyIds = new Set(companyIds);
    this.siteIds = new Set(siteIds);
    this.departmentIds = new Set(departmentIds);
  }

  /** True when the permission is held nowhere. */
  get isEmpty(): boolean {
    return (
      !this.tenantWide &&
      this.companyIds.size === 0 &&
      this.siteIds.size === 0 &&
      this.departmentIds.size === 0
    );
  }

  // ----- checks on one record

  coversCompany(companyId: string): boolean {
    return this.tenantWide || this.companyIds.has(companyId);
  }

  coversSite(site: SiteLocation): boolean {
    return this.coversCompany(site.companyId) || this.siteIds.has(site.id);
  }

  coversDepartment(department: DepartmentLocation): boolean {
    return (
      this.coversSite({ id: department.siteId, companyId: department.companyId }) ||
      this.departmentIds.has(department.id)
    );
  }

  // ----- database filters (Prisma `where` fragments). An empty scope matches nothing.

  companyFilter(): object {
    return this.tenantWide ? {} : { id: { in: [...this.companyIds] } };
  }

  siteFilter(): object {
    if (this.tenantWide) return {};
    return { OR: [{ companyId: { in: [...this.companyIds] } }, { id: { in: [...this.siteIds] } }] };
  }

  departmentFilter(): object {
    if (this.tenantWide) return {};
    return {
      OR: [
        { site: { companyId: { in: [...this.companyIds] } } },
        { siteId: { in: [...this.siteIds] } },
        { id: { in: [...this.departmentIds] } },
      ],
    };
  }
}

/** Everything a user may do, and where. */
export class Grants {
  constructor(private readonly scopes: ReadonlyMap<PermissionKey, AccessScope>) {}

  scopeOf(permission: PermissionKey): AccessScope {
    return this.scopes.get(permission) ?? AccessScope.NONE;
  }

  /** Permissions held for the whole tenant. */
  tenantWide(): ReadonlySet<PermissionKey> {
    return new Set([...this.scopes].filter(([, scope]) => scope.tenantWide).map(([key]) => key));
  }

  /** Permissions held on at least one scope. */
  anywhere(): ReadonlySet<PermissionKey> {
    return new Set([...this.scopes].filter(([, scope]) => !scope.isEmpty).map(([key]) => key));
  }
}

interface ScopeAccumulator {
  tenantWide: boolean;
  companies: string[];
  sites: string[];
  departments: string[];
}

/**
 * Computes the grants of a user from their role assignments — never cached, never
 * stored in a token: a change of role, of assignment or of scope takes effect at the
 * next request. The administrator (system) role stands for the whole catalogue,
 * including permissions added after the role was created.
 */
export async function loadGrants(tx: TenantTransaction, userId: string): Promise<Grants> {
  const assignments = await tx.roleAssignment.findMany({
    where: { userId },
    select: {
      scopeType: true,
      companyId: true,
      siteId: true,
      departmentId: true,
      role: { select: { isSystem: true, permissions: { select: { permission: true } } } },
    },
  });

  const accumulators = new Map<PermissionKey, ScopeAccumulator>();
  for (const assignment of assignments) {
    const permissions = assignment.role.isSystem
      ? PERMISSION_KEYS
      : // A key removed from the catalogue grants nothing, even if still stored.
        assignment.role.permissions.map((row) => row.permission).filter(isPermissionKey);
    for (const permission of permissions) {
      let entry = accumulators.get(permission);
      if (!entry) {
        entry = { tenantWide: false, companies: [], sites: [], departments: [] };
        accumulators.set(permission, entry);
      }
      if (assignment.scopeType === 'TENANT') entry.tenantWide = true;
      else if (assignment.companyId) entry.companies.push(assignment.companyId);
      else if (assignment.siteId) entry.sites.push(assignment.siteId);
      else if (assignment.departmentId) entry.departments.push(assignment.departmentId);
    }
  }

  return new Grants(
    new Map(
      [...accumulators].map(([permission, entry]) => [
        permission,
        new AccessScope(entry.tenantWide, entry.companies, entry.sites, entry.departments),
      ]),
    ),
  );
}
