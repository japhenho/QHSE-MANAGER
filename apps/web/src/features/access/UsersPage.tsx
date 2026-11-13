import { PERMISSIONS, type UserSummary } from '@qhse/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, CloseIcon, PageHeader, Pagination } from '../../components/ui';
import { useAuth, usePermissions } from '../../lib/auth';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { accessKeys, assignRole, listRoles, listUsers, PAGE_SIZE, unassignRole } from './api';
import { describeAccessError, roleLabel } from './labels';
import { ListStates } from './ListStates';

const FIELD_CLASSES =
  'min-h-touch rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg';

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
  const canAssign = can(PERMISSIONS.ROLE_ASSIGN) && can(PERMISSIONS.ROLE_READ);
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

  const change = useMutation({
    mutationFn: (input: { userId: string; roleId: string; add: boolean }) =>
      input.add ? assignRole(input.userId, input.roleId) : unassignRole(input.userId, input.roleId),
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
              busy={change.isPending}
              onChange={(roleId, add) => change.mutate({ userId: user.id, roleId, add })}
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
  busy: boolean;
  onChange: (roleId: string, add: boolean) => void;
}

function UserRow({ user, isSelf, roleOptions, busy, onChange }: UserRowProps) {
  const { t } = useTranslation();
  const selectId = useId();
  const [choice, setChoice] = useState('');
  const available = roleOptions?.filter((role) => !user.roles.some((held) => held.id === role.id));

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
        {user.roles.length === 0 ? <li className="text-fg-muted">{t('users.noRole')}</li> : null}
        {user.roles.map((role) => (
          <li
            key={role.id}
            className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-sunken pl-3 text-fg"
          >
            <span className="py-1.5">{roleLabel(role, t)}</span>
            {roleOptions ? (
              <button
                type="button"
                disabled={busy}
                aria-label={t('users.removeRole', { role: roleLabel(role, t), email: user.email })}
                onClick={() => onChange(role.id, false)}
                className="inline-flex size-touch items-center justify-center rounded-full hover:bg-danger-surface hover:text-danger-fg disabled:opacity-60"
              >
                <CloseIcon className="size-5" />
              </button>
            ) : (
              <span className="pr-3" />
            )}
          </li>
        ))}
      </ul>

      {/* Nobody assigns a role to themselves: the control is not offered on one's own row. */}
      {available && !isSelf && available.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={selectId} className="text-sm font-semibold text-fg">
              {t('users.addRole')}
              <span className="sr-only"> — {t('users.addRoleFor', { email: user.email })}</span>
            </label>
            <select
              id={selectId}
              className={FIELD_CLASSES}
              value={choice}
              disabled={busy}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">{t('users.chooseRole')}</option>
              {available.map((role) => (
                <option key={role.id} value={role.id}>
                  {roleLabel(role, t)}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            disabled={choice === '' || busy}
            onClick={() => {
              onChange(choice, true);
              setChoice('');
            }}
          >
            {t('users.add')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
