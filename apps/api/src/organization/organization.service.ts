import { Injectable } from '@nestjs/common';
import {
  type ArchiveFilter,
  type CompanyListQuery,
  type CompanyView,
  type CreateCompanyRequest,
  type CreateDepartmentRequest,
  type CreateSiteRequest,
  type DepartmentListQuery,
  type DepartmentView,
  ERROR_CODES,
  type OrganizationErrorReason,
  PERMISSIONS,
  type Paginated,
  type SiteListQuery,
  type SiteView,
  type UpdateCompanyRequest,
  type UpdateDepartmentRequest,
  type UpdateSiteRequest,
} from '@qhse/shared';
import { AuditService } from '../audit/index.js';
import type { Actor } from '../auth/access.decorators.js';
import { Clock } from '../common/clock.js';
import { AppException } from '../common/errors/app.exception.js';
import { AccessScope } from '../rbac/access-scope.js';
import { TenantDatabase, type TenantTransaction, uuidv7 } from '../tenancy/index.js';

const UNIQUE_VIOLATION = 'P2002';
type EntityType = 'company' | 'site' | 'department';

const READ = PERMISSIONS.ORGANIZATION_READ;
const MANAGE = PERMISSIONS.ORGANIZATION_MANAGE;

const notFound = (what: string) => new AppException(ERROR_CODES.NOT_FOUND, `${what} not found`);
const outsideScope = () =>
  new AppException(ERROR_CODES.FORBIDDEN, 'This action is outside the scope of your role', {
    details: { reason: 'outside_scope' },
  });
/** `reason` is a stable key the web application translates; `message` is for developers. */
const conflict = (reason: OrganizationErrorReason, message: string) =>
  new AppException(ERROR_CODES.CONFLICT, message, { details: { reason } });

/** Archived records are hidden from lists unless explicitly asked for. */
function archiveFilter(status: ArchiveFilter): { archivedAt?: null | { not: null } } {
  if (status === 'active') return { archivedAt: null };
  if (status === 'archived') return { archivedAt: { not: null } };
  return {};
}

function textSearch(search: string | undefined, fields: readonly string[]): object {
  if (!search) return {};
  return { OR: fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' } })) };
}

function pageOf<T>(
  query: { page: number; pageSize: number },
  items: T[],
  total: number,
): Paginated<T> {
  return { items, page: query.page, pageSize: query.pageSize, total };
}

const paging = (query: { page: number; pageSize: number }) => ({
  skip: (query.page - 1) * query.pageSize,
  take: query.pageSize,
});

/** Stable ordering: the requested field, then the id so that pages never overlap. */
const ordering = (query: { sort: string; order: 'asc' | 'desc' }) => [
  { [query.sort]: query.order },
  { id: 'asc' as const },
];

interface Timestamps {
  id: string;
  version: number;
  createdAt: Date;
  archivedAt: Date | null;
}

const base = (row: Timestamps) => ({
  id: row.id,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

type CompanyRow = Timestamps & { code: string; name: string };
type SiteRow = Timestamps & {
  companyId: string;
  code: string;
  name: string;
  countryCode: string;
  timeZone: string;
  currencyCode: string;
  company: { name: string };
};
type DepartmentRow = Timestamps & { siteId: string; name: string; site: { name: string } };

const toCompany = (row: CompanyRow): CompanyView => ({
  ...base(row),
  code: row.code,
  name: row.name,
});
const toSite = (row: SiteRow): SiteView => ({
  ...base(row),
  companyId: row.companyId,
  companyName: row.company.name,
  code: row.code,
  name: row.name,
  countryCode: row.countryCode,
  timeZone: row.timeZone,
  currencyCode: row.currencyCode,
});
const toDepartment = (row: DepartmentRow): DepartmentView => ({
  ...base(row),
  siteId: row.siteId,
  siteName: row.site.name,
  name: row.name,
});

const SITE_INCLUDE = { company: { select: { name: true } } } as const;
const DEPARTMENT_INCLUDE = { site: { select: { name: true } } } as const;

/**
 * Companies, sites and departments of a tenant.
 *
 * Scope: every read is filtered by where the caller holds `organization:read`, every
 * write by where they hold `organization:manage` (see `AccessScope`). A record outside
 * the scope gets the answer of an unknown identifier.
 *
 * Shared rules: nothing is ever physically deleted (archiving only); an archived record
 * is read-only until restored; a parent cannot be archived while it has active
 * children, and a child cannot be created under, or restored into, an archived parent;
 * every write checks the version the client read (no silent overwrite) and is audited.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------- companies

  listCompanies(actor: Actor, query: CompanyListQuery): Promise<Paginated<CompanyView>> {
    const where = {
      AND: [
        actor.scopeOf(READ).companyFilter(),
        archiveFilter(query.status),
        textSearch(query.search, ['name', 'code']),
      ],
    };
    return this.db.run(async (tx) => {
      const rows = await tx.company.findMany({ where, orderBy: ordering(query), ...paging(query) });
      return pageOf(query, rows.map(toCompany), await tx.company.count({ where }));
    });
  }

  getCompany(actor: Actor, id: string): Promise<CompanyView> {
    return this.db.run(async (tx) =>
      toCompany(await this.requireCompany(tx, id, actor.scopeOf(READ))),
    );
  }

  createCompany(actor: Actor, input: CreateCompanyRequest): Promise<CompanyView> {
    // A new company belongs to no existing scope: only a tenant-wide right can create it.
    if (!actor.scopeOf(MANAGE).tenantWide) throw outsideScope();
    return this.db.run(async (tx) => {
      const id = uuidv7();
      const row = await this.unique('code_taken', () =>
        tx.company.create({ data: { id, tenantId: actor.tenantId, ...input } }),
      );
      await this.recordCreated(tx, 'company', id, { code: input.code, name: input.name });
      return toCompany(row);
    });
  }

  updateCompany(actor: Actor, id: string, input: UpdateCompanyRequest): Promise<CompanyView> {
    const { version, ...changes } = input;
    return this.db.run(async (tx) => {
      this.assertEditable(await this.requireCompany(tx, id, actor.scopeOf(MANAGE)));
      const { count } = await this.unique('code_taken', () =>
        tx.company.updateMany({
          where: { id, version },
          data: { ...changes, version: { increment: 1 } },
        }),
      );
      this.assertFresh(count);
      await this.recordUpdated(tx, 'company', id, changes);
      return toCompany(await this.requireCompany(tx, id));
    });
  }

  archiveCompany(actor: Actor, id: string): Promise<CompanyView> {
    return this.db.run(async (tx) => {
      const company = await this.requireCompany(tx, id, actor.scopeOf(MANAGE));
      if (company.archivedAt === null) {
        const activeSites = await tx.site.count({ where: { companyId: id, archivedAt: null } });
        if (activeSites > 0) {
          throw conflict('has_active_children', 'Archive the sites of this company first');
        }
        await tx.company.update({ where: { id }, data: this.archived(actor) });
        await this.recordArchival(tx, 'company', id, true);
      }
      return toCompany(await this.requireCompany(tx, id));
    });
  }

  restoreCompany(actor: Actor, id: string): Promise<CompanyView> {
    return this.db.run(async (tx) => {
      const company = await this.requireCompany(tx, id, actor.scopeOf(MANAGE));
      if (company.archivedAt !== null) {
        await tx.company.update({ where: { id }, data: this.restored() });
        await this.recordArchival(tx, 'company', id, false);
      }
      return toCompany(await this.requireCompany(tx, id));
    });
  }

  // ------------------------------------------------------------------ sites

  listSites(actor: Actor, query: SiteListQuery): Promise<Paginated<SiteView>> {
    const where = {
      AND: [
        actor.scopeOf(READ).siteFilter(),
        archiveFilter(query.status),
        textSearch(query.search, ['name', 'code']),
        query.companyId ? { companyId: query.companyId } : {},
      ],
    };
    return this.db.run(async (tx) => {
      const rows = await tx.site.findMany({
        where,
        include: SITE_INCLUDE,
        orderBy: ordering(query),
        ...paging(query),
      });
      return pageOf(query, rows.map(toSite), await tx.site.count({ where }));
    });
  }

  getSite(actor: Actor, id: string): Promise<SiteView> {
    return this.db.run(async (tx) => toSite(await this.requireSite(tx, id, actor.scopeOf(READ))));
  }

  createSite(actor: Actor, input: CreateSiteRequest): Promise<SiteView> {
    return this.db.run(async (tx) => {
      // A company of another tenant, or outside the caller's scope, is invisible here:
      // same answer as an unknown id.
      const company = await this.requireCompany(tx, input.companyId, actor.scopeOf(MANAGE));
      if (company.archivedAt !== null) {
        throw conflict('parent_archived', 'The company is archived');
      }
      const id = uuidv7();
      await this.unique('code_taken', () =>
        tx.site.create({ data: { id, tenantId: actor.tenantId, ...input } }),
      );
      await this.recordCreated(tx, 'site', id, {
        code: input.code,
        name: input.name,
        companyId: input.companyId,
      });
      return toSite(await this.requireSite(tx, id));
    });
  }

  updateSite(actor: Actor, id: string, input: UpdateSiteRequest): Promise<SiteView> {
    const { version, ...changes } = input;
    return this.db.run(async (tx) => {
      this.assertEditable(await this.requireSite(tx, id, actor.scopeOf(MANAGE)));
      const { count } = await this.unique('code_taken', () =>
        tx.site.updateMany({
          where: { id, version },
          data: { ...changes, version: { increment: 1 } },
        }),
      );
      this.assertFresh(count);
      await this.recordUpdated(tx, 'site', id, changes);
      return toSite(await this.requireSite(tx, id));
    });
  }

  archiveSite(actor: Actor, id: string): Promise<SiteView> {
    return this.db.run(async (tx) => {
      const site = await this.requireSite(tx, id, actor.scopeOf(MANAGE));
      if (site.archivedAt === null) {
        const active = await tx.department.count({ where: { siteId: id, archivedAt: null } });
        if (active > 0) {
          throw conflict('has_active_children', 'Archive the departments of this site first');
        }
        await tx.site.update({ where: { id }, data: this.archived(actor) });
        await this.recordArchival(tx, 'site', id, true);
      }
      return toSite(await this.requireSite(tx, id));
    });
  }

  restoreSite(actor: Actor, id: string): Promise<SiteView> {
    return this.db.run(async (tx) => {
      const site = await this.requireSite(tx, id, actor.scopeOf(MANAGE));
      if (site.archivedAt !== null) {
        const company = await this.requireCompany(tx, site.companyId);
        if (company.archivedAt !== null) {
          throw conflict('parent_archived', 'Restore the company of this site first');
        }
        await tx.site.update({ where: { id }, data: this.restored() });
        await this.recordArchival(tx, 'site', id, false);
      }
      return toSite(await this.requireSite(tx, id));
    });
  }

  // ------------------------------------------------------------ departments

  listDepartments(actor: Actor, query: DepartmentListQuery): Promise<Paginated<DepartmentView>> {
    const where = {
      AND: [
        actor.scopeOf(READ).departmentFilter(),
        archiveFilter(query.status),
        textSearch(query.search, ['name']),
        query.siteId ? { siteId: query.siteId } : {},
      ],
    };
    return this.db.run(async (tx) => {
      const rows = await tx.department.findMany({
        where,
        include: DEPARTMENT_INCLUDE,
        orderBy: ordering(query),
        ...paging(query),
      });
      return pageOf(query, rows.map(toDepartment), await tx.department.count({ where }));
    });
  }

  getDepartment(actor: Actor, id: string): Promise<DepartmentView> {
    return this.db.run(async (tx) =>
      toDepartment(await this.requireDepartment(tx, id, actor.scopeOf(READ))),
    );
  }

  createDepartment(actor: Actor, input: CreateDepartmentRequest): Promise<DepartmentView> {
    return this.db.run(async (tx) => {
      const site = await this.requireSite(tx, input.siteId, actor.scopeOf(MANAGE));
      if (site.archivedAt !== null) throw conflict('parent_archived', 'The site is archived');
      const id = uuidv7();
      await this.unique('name_taken', () =>
        tx.department.create({ data: { id, tenantId: actor.tenantId, ...input } }),
      );
      await this.recordCreated(tx, 'department', id, { name: input.name, siteId: input.siteId });
      return toDepartment(await this.requireDepartment(tx, id));
    });
  }

  updateDepartment(
    actor: Actor,
    id: string,
    input: UpdateDepartmentRequest,
  ): Promise<DepartmentView> {
    const { version, ...changes } = input;
    return this.db.run(async (tx) => {
      this.assertEditable(await this.requireDepartment(tx, id, actor.scopeOf(MANAGE)));
      const { count } = await this.unique('name_taken', () =>
        tx.department.updateMany({
          where: { id, version },
          data: { ...changes, version: { increment: 1 } },
        }),
      );
      this.assertFresh(count);
      await this.recordUpdated(tx, 'department', id, changes);
      return toDepartment(await this.requireDepartment(tx, id));
    });
  }

  archiveDepartment(actor: Actor, id: string): Promise<DepartmentView> {
    return this.db.run(async (tx) => {
      const department = await this.requireDepartment(tx, id, actor.scopeOf(MANAGE));
      if (department.archivedAt === null) {
        await tx.department.update({ where: { id }, data: this.archived(actor) });
        await this.recordArchival(tx, 'department', id, true);
      }
      return toDepartment(await this.requireDepartment(tx, id));
    });
  }

  restoreDepartment(actor: Actor, id: string): Promise<DepartmentView> {
    return this.db.run(async (tx) => {
      const department = await this.requireDepartment(tx, id, actor.scopeOf(MANAGE));
      if (department.archivedAt !== null) {
        const site = await this.requireSite(tx, department.siteId);
        if (site.archivedAt !== null) {
          throw conflict('parent_archived', 'Restore the site of this department first');
        }
        await tx.department.update({ where: { id }, data: this.restored() });
        await this.recordArchival(tx, 'department', id, false);
      }
      return toDepartment(await this.requireDepartment(tx, id));
    });
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Loads a record, or answers "not found". With a `scope`, a record outside of it is
   * treated exactly like one that does not exist. Without one (internal lookups of a
   * parent, re-reads after a write) only the tenant boundary applies.
   */
  private async requireCompany(
    tx: TenantTransaction,
    id: string,
    scope: AccessScope = AccessScope.TENANT,
  ): Promise<CompanyRow> {
    const row = await tx.company.findFirst({ where: { AND: [{ id }, scope.companyFilter()] } });
    if (!row) throw notFound('Company');
    return row;
  }

  private async requireSite(
    tx: TenantTransaction,
    id: string,
    scope: AccessScope = AccessScope.TENANT,
  ): Promise<SiteRow> {
    const row = await tx.site.findFirst({
      where: { AND: [{ id }, scope.siteFilter()] },
      include: SITE_INCLUDE,
    });
    if (!row) throw notFound('Site');
    return row;
  }

  private async requireDepartment(
    tx: TenantTransaction,
    id: string,
    scope: AccessScope = AccessScope.TENANT,
  ): Promise<DepartmentRow> {
    const row = await tx.department.findFirst({
      where: { AND: [{ id }, scope.departmentFilter()] },
      include: DEPARTMENT_INCLUDE,
    });
    if (!row) throw notFound('Department');
    return row;
  }

  private assertEditable(row: { archivedAt: Date | null }): void {
    if (row.archivedAt !== null)
      throw conflict('archived', 'An archived record cannot be modified');
  }

  private assertFresh(updatedCount: number): void {
    if (updatedCount === 0) {
      throw conflict('stale_version', 'The record was modified by someone else; reload it');
    }
  }

  private archived(actor: Actor) {
    return { archivedAt: this.clock.now(), archivedBy: actor.userId, version: { increment: 1 } };
  }

  private restored() {
    return { archivedAt: null, archivedBy: null, version: { increment: 1 } };
  }

  private async unique<T>(reason: OrganizationErrorReason, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw conflict(reason, 'A record with the same identifier already exists');
      }
      throw error;
    }
  }

  private recordCreated(
    tx: TenantTransaction,
    type: EntityType,
    id: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    return this.audit.record(tx, { action: `${type}.created`, resource: { type, id }, metadata });
  }

  private recordUpdated(
    tx: TenantTransaction,
    type: EntityType,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(tx, {
      action: `${type}.updated`,
      resource: { type, id },
      metadata: { changes: changes as Record<string, string> },
    });
  }

  private recordArchival(
    tx: TenantTransaction,
    type: EntityType,
    id: string,
    archived: boolean,
  ): Promise<void> {
    return this.audit.record(tx, {
      action: archived ? `${type}.archived` : `${type}.restored`,
      resource: { type, id },
      transition: archived
        ? { from: 'ACTIVE', to: 'ARCHIVED' }
        : { from: 'ARCHIVED', to: 'ACTIVE' },
    });
  }
}
