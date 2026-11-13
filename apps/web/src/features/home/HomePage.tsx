import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../app/navigation';
import { Badge, Card, EmptyState, PageHeader, buttonClasses } from '../../components/ui';
import { usePageTitle } from '../../lib/hooks/usePageTitle';

/**
 * Phase 0 landing page. It states honestly what exists (the technical foundation) and
 * shows no KPI, chart or figure: there is no business data yet.
 */
export default function HomePage() {
  const { t } = useTranslation();
  usePageTitle(t('home.title'));

  return (
    <>
      <PageHeader title={t('home.title')} description={t('home.description')} />

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <Card
          title={t('home.foundationTitle')}
          aside={<Badge tone="info">{t('home.foundationBadge')}</Badge>}
        >
          <p className="text-base text-fg-muted">{t('home.foundationBody')}</p>
        </Card>

        <Card title={t('home.statusTitle')} className="flex flex-col">
          <p className="mb-4 text-base text-fg-muted">{t('home.statusBody')}</p>
          <Link
            to={ROUTES.systemStatus}
            className={buttonClasses({ variant: 'secondary', className: 'mt-auto self-start' })}
          >
            {t('home.statusLink')}
          </Link>
        </Card>

        <Card title={t('home.modulesTitle')} className="md:col-span-2">
          <EmptyState
            title={t('home.modulesEmptyTitle')}
            description={t('home.modulesEmptyBody')}
          />
        </Card>
      </div>
    </>
  );
}
