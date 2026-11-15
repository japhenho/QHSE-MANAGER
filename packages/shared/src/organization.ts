import { z } from 'zod';
import { paginationQuerySchema } from './pagination';
import { isCountryCode, isCurrencyCode, isTimeZone } from './reference-data';

/** Short identifier chosen by the tenant: upper-case letters, digits and hyphens. */
const entityCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, 'must contain only letters, digits and single hyphens')
  .min(2)
  .max(20);
const entityName = z.string().trim().min(2).max(120);
const version = z.number().int().min(1);

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCountryCode, 'must be an ISO 3166-1 alpha-2 country code');
const timeZone = z.string().trim().refine(isTimeZone, 'must be an IANA time zone');
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, 'must be an ISO 4217 currency code');

function atLeastOneChange<T extends z.ZodRawShape>(shape: T) {
  return z
    .strictObject({ ...shape, version })
    .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
      message: 'Nothing to change',
    });
}

// ---------------------------------------------------------------- companies

export const createCompanySchema = z.strictObject({ code: entityCode, name: entityName });
export type CreateCompanyRequest = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = atLeastOneChange({
  code: entityCode.optional(),
  name: entityName.optional(),
});
export type UpdateCompanyRequest = z.infer<typeof updateCompanySchema>;

// -------------------------------------------------------------------- sites

export const createSiteSchema = z.strictObject({
  companyId: z.uuid(),
  code: entityCode,
  name: entityName,
  countryCode,
  timeZone,
  currencyCode,
});
export type CreateSiteRequest = z.infer<typeof createSiteSchema>;

/** A site cannot be moved to another company: `companyId` is not updatable. */
export const updateSiteSchema = atLeastOneChange({
  code: entityCode.optional(),
  name: entityName.optional(),
  countryCode: countryCode.optional(),
  timeZone: timeZone.optional(),
  currencyCode: currencyCode.optional(),
});
export type UpdateSiteRequest = z.infer<typeof updateSiteSchema>;

// -------------------------------------------------------------- departments

export const createDepartmentSchema = z.strictObject({ siteId: z.uuid(), name: entityName });
export type CreateDepartmentRequest = z.infer<typeof createDepartmentSchema>;

/** A department cannot be moved to another site: `siteId` is not updatable. */
export const updateDepartmentSchema = atLeastOneChange({ name: entityName.optional() });
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentSchema>;

// ------------------------------------------------------------------ queries

export const ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

const listQuery = <T extends [string, ...string[]]>(sortFields: T) =>
  paginationQuerySchema.extend({
    search: z.string().trim().max(100).optional(),
    /** Archived records are hidden unless asked for. */
    status: z.enum(ARCHIVE_FILTERS).default('active'),
    sort: z.enum(sortFields).default(sortFields[0]),
    order: z.enum(['asc', 'desc']).default('asc'),
  });

export const companyListQuerySchema = listQuery(['name', 'code', 'createdAt']);
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;

export const siteListQuerySchema = listQuery(['name', 'code', 'createdAt']).extend({
  companyId: z.uuid().optional(),
});
export type SiteListQuery = z.infer<typeof siteListQuerySchema>;

export const departmentListQuerySchema = listQuery(['name', 'createdAt']).extend({
  siteId: z.uuid().optional(),
});
export type DepartmentListQuery = z.infer<typeof departmentListQuerySchema>;

// -------------------------------------------------------------------- views

interface Archivable {
  id: string;
  version: number;
  /** ISO 8601 UTC, server time. */
  createdAt: string;
  /** ISO 8601 UTC when archived, else null. */
  archivedAt: string | null;
}

export interface CompanyView extends Archivable {
  code: string;
  name: string;
}

export interface SiteView extends Archivable {
  companyId: string;
  companyName: string;
  code: string;
  name: string;
  countryCode: string;
  timeZone: string;
  currencyCode: string;
}

export interface DepartmentView extends Archivable {
  siteId: string;
  siteName: string;
  name: string;
}

/** Stable reasons carried in `details.reason` of organisation errors. */
export const ORGANIZATION_ERROR_REASONS = [
  'code_taken',
  'name_taken',
  'stale_version',
  'has_active_children',
  'parent_archived',
  'archived',
] as const;
export type OrganizationErrorReason = (typeof ORGANIZATION_ERROR_REASONS)[number];
