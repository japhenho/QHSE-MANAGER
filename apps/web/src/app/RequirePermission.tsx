import type { PermissionKey } from '@qhse/shared';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { ErrorState, PageHeader } from '../components/ui';
import { usePermissions } from '../lib/auth';

/**
 * Shows an explicit "access denied" page instead of a screen whose every request would
 * be refused. A courtesy to the user: the server remains the only judge.
 */
interface RequirePermissionProps {
  permission: PermissionKey;
  /** Accept the permission when held on any scope (pages filtered by scope). */
  anyScope?: boolean;
}

export function RequirePermission({ permission, anyScope }: RequirePermissionProps) {
  const { t } = useTranslation();
  const can = usePermissions();
  if (can(permission, { anywhere: anyScope })) return <Outlet />;
  return (
    <>
      <PageHeader title={t('access.forbiddenTitle')} />
      <ErrorState title={t('access.forbiddenTitle')} description={t('access.forbiddenBody')} />
    </>
  );
}
