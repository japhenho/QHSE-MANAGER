import { SUPPORTED_LOCALES } from '@qhse/shared';
import { useTranslation } from 'react-i18next';
import { LOCALE_NAMES, changeLocale, getCurrentLocale } from '../i18n';
import { cx } from '../lib/cx';

/** One button per supported locale; scales to a third language without layout changes. */
export function LanguageSwitcher() {
  const { t } = useTranslation();
  const current = getCurrentLocale();

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="inline-flex overflow-hidden rounded-control border-2 border-line-strong bg-surface"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const selected = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={selected}
            aria-label={LOCALE_NAMES[locale]}
            title={LOCALE_NAMES[locale]}
            onClick={() => void changeLocale(locale)}
            className={cx(
              'min-h-touch min-w-touch px-3 text-base font-semibold uppercase -outline-offset-3 transition-colors',
              selected
                ? 'bg-primary text-on-primary focus-visible:outline-on-primary'
                : 'bg-surface text-fg hover:bg-surface-sunken',
            )}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
