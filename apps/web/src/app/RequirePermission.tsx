import type { PermissionKey } from '@qhse/shared';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { ErrorState, PageHeader } from '../components/ui';
import { usePermissions } from '../lib/auth';

/**
 * Shows an explicit "access denied" page instead of a screen whose every request would
 * be refused. A courtesy to the user: the server remains the only judge.
 */
export function RequirePermission({ permission }: { permission: PermissionKey }) {
  const { t } = useTranslation();
  const can = usePermissions();
  if (can(permission)) return <Outlet />;
  return (
    <>
      <PageHeader title={t('access.forbiddenTitle')} />
      <ErrorState title={t('access.forbiddenTitle')} description={t('access.forbiddenBody')} />
    </>
  );
}
