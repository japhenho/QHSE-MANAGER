import { useTranslation } from 'react-i18next';
import { ErrorState } from '../components/ui';

/** Full-page message shown instead of the app when the build configuration is unusable. */
export function ConfigErrorScreen({ variable }: { variable: string }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold text-fg">{t('app.name')}</h1>
      <ErrorState
        title={t('errors.configTitle')}
        description={t('errors.configDescription', { variable })}
      />
    </main>
  );
}
