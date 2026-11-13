import { useTranslation } from 'react-i18next';
import { Button, ErrorState, RefreshIcon } from '../components/ui';

/**
 * Shown when a route fails to load or render — typically a lazy chunk that could not
 * be downloaded on an unstable connection. A full reload fetches it again.
 */
export function RouteError() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <ErrorState
        title={t('errors.routeTitle')}
        description={t('errors.routeDescription')}
        action={
          <Button
            variant="secondary"
            icon={<RefreshIcon className="size-5" />}
            onClick={() => window.location.reload()}
          >
            {t('common.reload')}
          </Button>
        }
      />
    </div>
  );
}
