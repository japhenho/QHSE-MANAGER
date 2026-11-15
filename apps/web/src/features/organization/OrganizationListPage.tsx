import { PERMISSIONS, type SiteView } from '@qhse/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, buttonClasses, PageHeader, Pagination } from '../../components/ui';
import { getCurrentLocale } from '../../i18n';
import { usePermissions } from '../../lib/auth';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { ListStates } from '../access/ListStates';
import { listEntities, listOptions, type ListParams, organizationKeys, ORG_PAGE_SIZE } from './api';
import { detailPath, ENTITIES, type EntityKind, type EntityView } from './entities';
import { OrganizationTabs } from './OrganizationTabs';

const FIELD_CLASSES =
  'min-h-touch w-full rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg';

const PARENT_KIND: Record<EntityKind, EntityKind | undefined> = {
  companies: undefined,
  sites: 'companies',
  departments: 'sites',
};

type Column = 'code' | 'name' | 'company' | 'site' | 'country' | 'timeZone' | 'currency' | 'status';
const COLUMNS: Record<EntityKind, readonly Column[]> = {
  companies: ['code', 'name', 'status'],
  sites: ['code', 'name', 'company', 'country', 'timeZone', 'currency', 'status'],
  departments: ['name', 'site', 'status'],
};

export function OrganizationListPage({ kind }: { kind: EntityKind }) {
  const { t } = useTranslation();
  usePageTitle(`${t('organization.title')} · ${t(`organization.${kind}.tab`)}`);
  const can = usePermissions();
  const formId = useId();
  const config = ENTITIES[kind];
  const parentKind = PARENT_KIND[kind];

  const [searchInput, setSearchInput] = useState('');
  const [params, setParams] = useState<ListParams>({
    page: 1,
    search: '',
    status: 'active',
    sort: 'name',
    order: 'asc',
    parentId: '',
  });

  const list = useQuery({
    queryKey: organizationKeys.list(kind, params),
    queryFn: ({ signal }) => listEntities(kind, params, signal),
    placeholderData: keepPreviousData,
  });
  const parents = useQuery({
    queryKey: [...organizationKeys.all(parentKind ?? kind), 'options'],
    queryFn: ({ signal }) => listOptions(parentKind ?? kind, signal),
    enabled: parentKind !== undefined,
  });

  const regionNames = new Intl.DisplayNames([getCurrentLocale()], { type: 'region' });

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setParams({ ...params, page: 1, search: searchInput.trim() });
  }

  function toggleSort(column: 'name' | 'code') {
    setParams({
      ...params,
      page: 1,
      sort: column,
      order: params.sort === column && params.order === 'asc' ? 'desc' : 'asc',
    });
  }

  function cell(column: Column, entity: EntityView) {
    const site = entity as SiteView;
    switch (column) {
      case 'code':
        return <span className="font-mono">{site.code}</span>;
      case 'name':
        return (
          <Link
            to={detailPath(kind, entity.id)}
            className="inline-flex min-h-touch items-center font-semibold text-primary underline underline-offset-4"
          >
            {entity.name}
          </Link>
        );
      case 'company':
        return site.companyName;
      case 'site':
        return (entity as { siteName?: string }).siteName;
      case 'country':
        return regionNames.of(site.countryCode) ?? site.countryCode;
      case 'timeZone':
        return <span className="font-mono text-sm">{site.timeZone}</span>;
      case 'currency':
        return <span className="font-mono">{site.currencyCode}</span>;
      case 'status':
        return entity.archivedAt ? (
          <Badge tone="neutral">{t('organization.statusArchived')}</Badge>
        ) : (
          <Badge tone="success">{t('organization.statusActive')}</Badge>
        );
    }
  }

  const sortableColumn = (column: Column): column is 'name' | 'code' =>
    (config.sortable as readonly string[]).includes(column);

  return (
    <>
      <PageHeader
        title={t('organization.title')}
        description={t('organization.description')}
        actions={
          // Creating a company needs the right for the whole tenant; a site or a
          // department can be created by someone managing a narrower scope.
          can(PERMISSIONS.ORGANIZATION_MANAGE, { anywhere: kind !== 'companies' }) ? (
            <Link to={config.newPath} className={buttonClasses()}>
              {t(`organization.${kind}.create`)}
            </Link>
          ) : null
        }
      />
      <OrganizationTabs />

      <form
        onSubmit={onSearch}
        role="search"
        className="mb-4 grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${formId}-search`} className="text-sm font-semibold text-fg">
            {t('organization.filters.search')}
          </label>
          <input
            id={`${formId}-search`}
            type="search"
            className={FIELD_CLASSES}
            maxLength={100}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        {parentKind ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${formId}-parent`} className="text-sm font-semibold text-fg">
              {t(
                parentKind === 'companies'
                  ? 'organization.fields.company'
                  : 'organization.fields.site',
              )}
            </label>
            <select
              id={`${formId}-parent`}
              className={FIELD_CLASSES}
              value={params.parentId}
              onChange={(event) => setParams({ ...params, page: 1, parentId: event.target.value })}
            >
              <option value="">
                {t(
                  parentKind === 'companies'
                    ? 'organization.filters.allCompanies'
                    : 'organization.filters.allSites',
                )}
              </option>
              {parents.data?.items.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${formId}-status`} className="text-sm font-semibold text-fg">
            {t('organization.filters.status')}
          </label>
          <select
            id={`${formId}-status`}
            className={FIELD_CLASSES}
            value={params.status}
            onChange={(event) =>
              setParams({ ...params, page: 1, status: event.target.value as ListParams['status'] })
            }
          >
            <option value="active">{t('organization.filters.active')}</option>
            <option value="archived">{t('organization.filters.archived')}</option>
            <option value="all">{t('organization.filters.all')}</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          {t('organization.filters.searchSubmit')}
        </Button>
      </form>

      <ListStates
        isPending={list.isPending}
        error={list.error}
        isEmpty={list.data?.items.length === 0}
        emptyTitle={t(`organization.${kind}.emptyTitle`)}
        emptyDescription={t(`organization.${kind}.emptyBody`)}
        onRetry={() => void list.refetch()}
      >
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="border-b border-line text-sm tracking-wide text-fg-muted uppercase">
              <tr>
                {COLUMNS[kind].map((column) => {
                  const label = t(`organization.fields.${column}`);
                  if (!sortableColumn(column)) {
                    return (
                      <th key={column} scope="col" className="px-4 py-3 font-semibold">
                        {label}
                      </th>
                    );
                  }
                  const active = params.sort === column;
                  return (
                    <th
                      key={column}
                      scope="col"
                      className="px-2 py-1 font-semibold"
                      aria-sort={
                        active ? (params.order === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        aria-label={t('organization.sortBy', { column: label })}
                        className="inline-flex min-h-touch items-center gap-1 rounded-control px-2 font-semibold tracking-wide uppercase hover:bg-surface-sunken"
                      >
                        {label}
                        <span aria-hidden="true">
                          {active ? (params.order === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((entity) => (
                <tr key={entity.id} className="border-b border-line last:border-b-0">
                  {COLUMNS[kind].map((column) => (
                    <td key={column} className="px-4 py-2 align-middle text-fg">
                      {cell(column, entity)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={params.page}
          pageSize={ORG_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onChange={(page) => setParams({ ...params, page })}
        />
      </ListStates>
    </>
  );
}
