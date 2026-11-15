import type { CompanyView, DepartmentView, SiteView } from '@qhse/shared';
import { ROUTES } from '../../app/navigation';

export type EntityKind = 'companies' | 'sites' | 'departments';
export type EntityView = CompanyView | SiteView | DepartmentView;

/** Fields of the form, as strings (what inputs hold). */
export type FormValues = Record<
  'companyId' | 'siteId' | 'code' | 'name' | 'countryCode' | 'timeZone' | 'currencyCode',
  string
>;
export type FieldName = keyof FormValues;

interface EntityConfig {
  /** API resource and list route. */
  readonly listPath: string;
  readonly newPath: string;
  readonly detailPath: string;
  /** Fields shown in the form, in order. */
  readonly fields: readonly FieldName[];
  /** Parent chosen at creation and never changed afterwards. */
  readonly parent?: 'companyId' | 'siteId';
  readonly sortable: readonly ('name' | 'code')[];
}

export const ENTITIES: Record<EntityKind, EntityConfig> = {
  companies: {
    listPath: ROUTES.companies,
    newPath: ROUTES.companyNew,
    detailPath: ROUTES.company,
    fields: ['code', 'name'],
    sortable: ['code', 'name'],
  },
  sites: {
    listPath: ROUTES.sites,
    newPath: ROUTES.siteNew,
    detailPath: ROUTES.site,
    fields: ['companyId', 'code', 'name', 'countryCode', 'timeZone', 'currencyCode'],
    parent: 'companyId',
    sortable: ['code', 'name'],
  },
  departments: {
    listPath: ROUTES.departments,
    newPath: ROUTES.departmentNew,
    detailPath: ROUTES.department,
    fields: ['siteId', 'name'],
    parent: 'siteId',
    sortable: ['name'],
  },
};

export const ENTITY_KINDS = Object.keys(ENTITIES) as EntityKind[];

export function detailPath(kind: EntityKind, id: string): string {
  return ENTITIES[kind].detailPath.replace(':id', id);
}

export const EMPTY_VALUES: FormValues = {
  companyId: '',
  siteId: '',
  code: '',
  name: '',
  countryCode: '',
  timeZone: '',
  currencyCode: '',
};

/** Form values of an existing record (fields it does not have stay empty). */
export function valuesOf(entity: EntityView): FormValues {
  return { ...EMPTY_VALUES, ...(entity as unknown as Partial<FormValues>) };
}
