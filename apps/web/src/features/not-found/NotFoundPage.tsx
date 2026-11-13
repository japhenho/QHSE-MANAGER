import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../app/navigation';
import { CompassIcon, EmptyState, PageHeader, buttonClasses } from '../../components/ui';
import { usePageTitle } from '../../lib/hooks/usePageTitle';

export default function NotFoundPage() {
  const { t } = useTranslation();
  usePageTitle(t('notFound.title'));

  return (
    <>
      <PageHeader title={t('notFound.title')} />
      <EmptyState
        icon={CompassIcon}
        title={t('notFound.description')}
        action={
          <Link to={ROUTES.home} className={buttonClasses()}>
            {t('common.backToHome')}
          </Link>
        }
      />
    </>
  );
}
