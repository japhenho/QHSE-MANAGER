import type {
  AuditEventView,
  CreateRoleRequest,
  Paginated,
  RoleSummary,
  UpdateRoleRequest,
  UserSummary,
} from '@qhse/shared';
import { apiFetch } from '../../lib/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Minimal shape check of a paginated answer; items are typed by the shared contract. */
function parsePage<T>(data: unknown): Paginated<T> {
  if (!isRecord(data) || !Array.isArray(data['items']) || typeof data['total'] !== 'number') {
    throw new TypeError('paginated response');
  }
  return data as unknown as Paginated<T>;
}

function parseRole(data: unknown): RoleSummary {
  if (!isRecord(data) || typeof data['id'] !== 'string' || !Array.isArray(data['permissions'])) {
    throw new TypeError('role');
  }
  return data as unknown as RoleSummary;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const accessKeys = {
  roles: (page: number) => ['roles', 'list', page] as const,
  allRoles: ['roles'] as const,
  role: (id: string) => ['roles', 'detail', id] as const,
  users: (page: number, search: string) => ['users', page, search] as const,
  allUsers: ['users'] as const,
  auditEvents: (filters: object) => ['audit-events', filters] as const,
};

export const PAGE_SIZE = 25;

export function listRoles(page: number, signal?: AbortSignal, pageSize = PAGE_SIZE) {
  return apiFetch(`/roles${query({ page, pageSize })}`, { signal, parse: parsePage<RoleSummary> });
}

export function getRole(id: string, signal?: AbortSignal) {
  return apiFetch(`/roles/${id}`, { signal, parse: parseRole });
}

export function createRole(body: CreateRoleRequest) {
  return apiFetch('/roles', { method: 'POST', body, parse: parseRole });
}

export function updateRole(id: string, body: UpdateRoleRequest) {
  return apiFetch(`/roles/${id}`, { method: 'PATCH', body, parse: parseRole });
}

export function deleteRole(id: string) {
  return apiFetch(`/roles/${id}`, { method: 'DELETE' });
}

export function listUsers(page: number, search: string, signal?: AbortSignal) {
  return apiFetch(`/users${query({ page, pageSize: PAGE_SIZE, search })}`, {
    signal,
    parse: parsePage<UserSummary>,
  });
}

export function assignRole(userId: string, roleId: string) {
  return apiFetch(`/users/${userId}/roles/${roleId}`, { method: 'PUT' });
}

export function unassignRole(userId: string, roleId: string) {
  return apiFetch(`/users/${userId}/roles/${roleId}`, { method: 'DELETE' });
}

export interface AuditFilters {
  page: number;
  action: string;
  /** ISO date-times, or empty. */
  from: string;
  to: string;
}

export function listAuditEvents(filters: AuditFilters, signal?: AbortSignal) {
  return apiFetch(
    `/audit-events${query({ page: filters.page, pageSize: PAGE_SIZE, action: filters.action, from: filters.from, to: filters.to })}`,
    { signal, parse: parsePage<AuditEventView> },
  );
}
