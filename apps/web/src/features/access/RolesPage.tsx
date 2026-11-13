import { PERMISSIONS } from '@qhse/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { rolePath, ROUTES } from '../../app/navigation';
import { Badge, buttonClasses, PageHeader, Pagination } from '../../components/ui';
import { usePermissions } from '../../lib/auth';
import { usePageTitle } from '../../lib/hooks/usePageTitle';
import { accessKeys, listRoles, PAGE_SIZE } from './api';
import { roleLabel } from './labels';
import { ListStates } from './ListStates';

export default function RolesPage() {
  const { t } = useTranslation();
  usePageTitle(t('roles.title'));
  const can = usePermissions();
  const [page, setPage] = useState(1);
  const roles = useQuery({
    queryKey: accessKeys.roles(page),
    queryFn: ({ signal }) => listRoles(page, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.description')}
        actions={
          can(PERMISSIONS.ROLE_MANAGE) ? (
            <Link to={ROUTES.roleNew} className={buttonClasses()}>
              {t('roles.create')}
            </Link>
          ) : null
        }
      />

      <ListStates
        isPending={roles.isPending}
        error={roles.error}
        isEmpty={roles.data?.items.length === 0}
        emptyTitle={t('roles.emptyTitle')}
        onRetry={() => void roles.refetch()}
      >
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[32rem] text-left">
            <thead className="border-b border-line text-sm tracking-wide text-fg-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('roles.columnName')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('roles.columnPermissions')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('roles.columnUsers')}
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.data?.items.map((role) => (
                <tr key={role.id} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3 align-top font-normal">
                    <Link
                      to={rolePath(role.id)}
                      className="inline-flex min-h-touch items-center font-semibold text-primary underline underline-offset-4"
                    >
                      {roleLabel(role, t)}
                    </Link>
                    {role.description ? (
                      <p className="text-sm text-fg-muted">{role.description}</p>
                    ) : null}
                  </th>
                  <td className="px-4 py-3 align-top">
                    {role.isSystem ? (
                      <Badge tone="info">{t('roles.systemBadge')}</Badge>
                    ) : (
                      t('roles.permissionCount', { count: role.permissions.length })
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono">
                    {t('roles.userCount', { count: role.assignedUserCount })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={roles.data?.total ?? 0}
          onChange={setPage}
        />
      </ListStates>
    </>
  );
}
