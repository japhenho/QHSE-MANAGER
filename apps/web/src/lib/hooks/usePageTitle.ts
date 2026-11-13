import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Keeps the browser tab title in sync with the current page, in the current language. */
export function usePageTitle(page: string): void {
  const { t } = useTranslation();
  const title = t('app.pageTitle', { page });
  useEffect(() => {
    document.title = title;
  }, [title]);
}
