import type { Paginated } from '@qhse/shared';
import { apiFetch } from '../../lib/api';
import type { EntityKind, EntityView } from './entities';

export const ORG_PAGE_SIZE = 25;

export interface ListParams {
  page: number;
  search: string;
  status: 'active' | 'archived' | 'all';
  sort: 'name' | 'code';
  order: 'asc' | 'desc';
  /** Company (for sites) or site (for departments) to restrict the list to. */
  parentId: string;
  pageSize?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePage(data: unknown): Paginated<EntityView> {
  if (!isRecord(data) || !Array.isArray(data['items']) || typeof data['total'] !== 'number') {
    throw new TypeError('paginated response');
  }
  return data as unknown as Paginated<EntityView>;
}

function parseEntity(data: unknown): EntityView {
  if (!isRecord(data) || typeof data['id'] !== 'string' || typeof data['version'] !== 'number') {
    throw new TypeError('entity');
  }
  return data as unknown as EntityView;
}

const PARENT_PARAM: Record<EntityKind, string | undefined> = {
  companies: undefined,
  sites: 'companyId',
  departments: 'siteId',
};

export const organizationKeys = {
  all: (kind: EntityKind) => ['organization', kind] as const,
  list: (kind: EntityKind, params: ListParams) => ['organization', kind, 'list', params] as const,
  detail: (kind: EntityKind, id: string) => ['organization', kind, 'detail', id] as const,
};

export function listEntities(kind: EntityKind, params: ListParams, signal?: AbortSignal) {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize ?? ORG_PAGE_SIZE),
    status: params.status,
    sort: params.sort,
    order: params.order,
  });
  if (params.search) search.set('search', params.search);
  const parentParam = PARENT_PARAM[kind];
  if (parentParam && params.parentId) search.set(parentParam, params.parentId);
  return apiFetch(`/${kind}?${search.toString()}`, { signal, parse: parsePage });
}

/** Active records of a kind, for the "parent" menus (100 is the server-side maximum). */
export function listOptions(kind: EntityKind, signal?: AbortSignal) {
  return listEntities(
    kind,
    {
      page: 1,
      pageSize: 100,
      search: '',
      status: 'active',
      sort: 'name',
      order: 'asc',
      parentId: '',
    },
    signal,
  );
}

export function getEntity(kind: EntityKind, id: string, signal?: AbortSignal) {
  return apiFetch(`/${kind}/${id}`, { signal, parse: parseEntity });
}

export function createEntity(kind: EntityKind, body: object) {
  return apiFetch(`/${kind}`, { method: 'POST', body, parse: parseEntity });
}

export function updateEntity(kind: EntityKind, id: string, body: object) {
  return apiFetch(`/${kind}/${id}`, { method: 'PATCH', body, parse: parseEntity });
}

export function setArchived(kind: EntityKind, id: string, archived: boolean) {
  return apiFetch(`/${kind}/${id}/${archived ? 'archive' : 'restore'}`, {
    method: 'POST',
    parse: parseEntity,
  });
}
