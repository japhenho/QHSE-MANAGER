import {
  type AccessScopeType,
  type AssignRoleRequest,
  PERMISSIONS,
  type RoleAssignmentView,
  type UserSummary,
} from '@qhse/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, CloseIcon, PageHeader, Pagination } from '../../components/ui';
import { useAuth, usePermissions } from '../../lib/auth';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { listOptions, organizationKeys } from '../organization/api';
import type { EntityKind } from '../organization/entities';
import { accessKeys, assignRole, listRoles, listUsers, PAGE_SIZE, unassignRole } from './api';
import { describeAccessError, roleLabel } from './labels';
import { ListStates } from './ListStates';

const FIELD_CLASSES =
  'min-h-touch rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg';

const SCOPE_TYPE_LABELS = {
  tenant: 'access.scopes.tenant',
  company: 'access.scopes.company',
  site: 'access.scopes.site',
  department: 'access.scopes.department',
} as const;

/** "Whole organisation", or "Site: Djeno". */
function scopeLabel(
  assignment: Pick<RoleAssignmentView, 'scopeType' | 'scopeName'>,
  t: TFunction,
): string {
  const name = assignment.scopeName ?? '';
  switch (assignment.scopeType) {
    case 'tenant':
      return t('access.scopes.tenant');
    case 'company':
      return t('access.scopes.onCompany', { name });
    case 'site':
      return t('access.scopes.onSite', { name });
    case 'department':
      return t('access.scopes.onDepartment', { name });
  }
}

type ScopeOptions = Record<Exclude<AccessScopeType, 'tenant'>, { id: string; name: string }[]>;

export default function UsersPage() {
  const { t } = useTranslation();
  usePageTitle(t('users.title'));
  const can = usePermissions();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const searchId = useId();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const canAssign = can(PERMISSIONS.ROLE_ASSIGN, { anywhere: true }) && can(PERMISSIONS.ROLE_READ);
  // Narrower scopes can only be offered to someone who may read the organisation.
  const canPickScope = canAssign && can(PERMISSIONS.ORGANIZATION_READ, { anywhere: true });
  const selfId = auth.status === 'authenticated' ? auth.identity.user.id : undefined;

  const users = useQuery({
    queryKey: accessKeys.users(page, search),
    queryFn: ({ signal }) => listUsers(page, search, signal),
    placeholderData: keepPreviousData,
  });
  // Roles offered in the "add" menus. 100 is the server-side maximum page size.
  const roles = useQuery({
    queryKey: [...accessKeys.allRoles, 'options'],
    queryFn: ({ signal }) => listRoles(1, signal, 100),
    enabled: canAssign,
  });
  const scopeQuery = (kind: EntityKind) => ({
    queryKey: [...organizationKeys.all(kind), 'options'],
    queryFn: ({ signal }: { signal: AbortSignal }) => listOptions(kind, signal),
    enabled: canPickScope,
  });
  const companies = useQuery(scopeQuery('companies'));
  const sites = useQuery(scopeQuery('sites'));
  const departments = useQuery(scopeQuery('departments'));
  const scopeOptions: ScopeOptions | undefined = canPickScope
    ? {
        company: companies.data?.items ?? [],
        site: sites.data?.items ?? [],
        department: departments.data?.items ?? [],
      }
    : undefined;

  const change = useMutation({
    mutationFn: (input: { userId: string; add?: AssignRoleRequest; removeId?: string }) =>
      input.add
        ? assignRole(input.userId, input.add)
        : unassignRole(input.userId, input.removeId ?? ''),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: accessKeys.allUsers }),
        queryClient.invalidateQueries({ queryKey: accessKeys.allRoles }),
      ]),
  });

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <>
      <PageHeader title={t('users.title')} description={t('users.description')} />

      <form onSubmit={onSearch} role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-semibold text-fg">
            {t('users.search')}
          </label>
          <input
            id={searchId}
            type="search"
            className={`${FIELD_CLASSES} w-full`}
            value={searchInput}
            maxLength={100}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('users.searchSubmit')}
        </Button>
      </form>

      <div role="alert" className="mb-4 empty:hidden">
        {change.error ? (
          <p className="rounded-control border-2 border-danger bg-danger-surface px-3 py-2 font-medium text-danger-fg">
            {describeAccessError(change.error, t)}
          </p>
        ) : null}
      </div>

      <ListStates
        isPending={users.isPending}
        error={users.error}
        isEmpty={users.data?.items.length === 0}
        emptyTitle={t('users.emptyTitle')}
        onRetry={() => void users.refetch()}
      >
        <ul className="flex flex-col gap-3">
          {users.data?.items.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === selfId}
              roleOptions={canAssign ? (roles.data?.items ?? []) : undefined}
              scopeOptions={scopeOptions}
              busy={change.isPending}
              onAdd={(add) => change.mutate({ userId: user.id, add })}
              onRemove={(removeId) => change.mutate({ userId: user.id, removeId })}
            />
          ))}
        </ul>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={users.data?.total ?? 0}
          onChange={setPage}
        />
      </ListStates>
    </>
  );
}

interface UserRowProps {
  user: UserSummary;
  isSelf: boolean;
  /** Undefined when the signed-in user may not assign roles. */
  roleOptions: { id: string; name: string; referenceKey: string | null }[] | undefined;
  /** Undefined when only the whole organisation can be offered as a scope. */
  scopeOptions: ScopeOptions | undefined;
  busy: boolean;
  onAdd: (assignment: AssignRoleRequest) => void;
  onRemove: (assignmentId: string) => void;
}

function UserRow({ user, isSelf, roleOptions, scopeOptions, busy, onAdd, onRemove }: UserRowProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [roleId, setRoleId] = useState('');
  const [scopeType, setScopeType] = useState<AccessScopeType>('tenant');
  const [scopeId, setScopeId] = useState('');

  const complete = roleId !== '' && (scopeType === 'tenant' || scopeId !== '');

  function add() {
    onAdd(scopeType === 'tenant' ? { roleId, scopeType } : { roleId, scopeType, scopeId });
    setRoleId('');
    setScopeType('tenant');
    setScopeId('');
  }

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 font-mono text-base font-medium break-all text-fg">{user.email}</p>
        {isSelf ? <Badge tone="info">{t('users.you')}</Badge> : null}
        <Badge tone={user.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {user.status === 'ACTIVE' ? t('users.statusActive') : t('users.statusDisabled')}
        </Badge>
      </div>

      <ul
        aria-label={t('users.rolesOf', { email: user.email })}
        className="mt-3 flex flex-wrap gap-2"
      >
        {user.assignments.length === 0 ? (
          <li className="text-fg-muted">{t('users.noRole')}</li>
        ) : null}
        {user.assignments.map((assignment) => {
          const role = roleLabel(assignment.role, t);
          const scope = scopeLabel(assignment, t);
          return (
            <li
              key={assignment.id}
              className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-surface-sunken pl-3 text-fg"
            >
              <span className="py-1.5">
                <span className="font-semibold">{role}</span>
                <span className="text-fg-muted"> · {scope}</span>
              </span>
              {roleOptions ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('users.removeAssignment', { email: user.email, role, scope })}
                  onClick={() => onRemove(assignment.id)}
                  className="inline-flex size-touch items-center justify-center rounded-control hover:bg-danger-surface hover:text-danger-fg disabled:opacity-60"
                >
                  <CloseIcon className="size-5" />
                </button>
              ) : (
                <span className="pr-3" />
              )}
            </li>
          );
        })}
      </ul>

      {/* Nobody assigns a role to themselves: the control is not offered on one's own row. */}
      {roleOptions && !isSelf && roleOptions.length > 0 ? (
        <fieldset className="mt-3 flex flex-wrap items-end gap-2">
          <legend className="sr-only">{t('users.addRoleFor', { email: user.email })}</legend>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${formId}-role`} className="text-sm font-semibold text-fg">
              {t('users.role')}
            </label>
            <select
              id={`${formId}-role`}
              className={FIELD_CLASSES}
              value={roleId}
              disabled={busy}
              onChange={(event) => setRoleId(event.target.value)}
            >
              <option value="">{t('users.chooseRole')}</option>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {roleLabel(role, t)}
                </option>
              ))}
            </select>
          </div>
          {scopeOptions ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${formId}-scope`} className="text-sm font-semibold text-fg">
                {t('access.scopes.label')}
              </label>
              <select
                id={`${formId}-scope`}
                className={FIELD_CLASSES}
                value={scopeType}
                disabled={busy}
                onChange={(event) => {
                  setScopeType(event.target.value as AccessScopeType);
                  setScopeId('');
                }}
              >
                {(['tenant', 'company', 'site', 'department'] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(SCOPE_TYPE_LABELS[type])}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {scopeOptions && scopeType !== 'tenant' ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${formId}-scope-id`} className="text-sm font-semibold text-fg">
                {t('users.scopeEntity')}
              </label>
              <select
                id={`${formId}-scope-id`}
                className={FIELD_CLASSES}
                value={scopeId}
                disabled={busy}
                onChange={(event) => setScopeId(event.target.value)}
              >
                <option value="">{t('access.scopes.choose')}</option>
                {scopeOptions[scopeType].map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button variant="secondary" disabled={!complete || busy} onClick={add}>
            {t('users.add')}
          </Button>
        </fieldset>
      ) : null}
    </li>
  );
}
