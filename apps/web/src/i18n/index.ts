import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, type Locale } from '@qhse/shared';
import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectLocale, persistLocale } from './locale-storage';
import { translations } from './locales';

const resources: Resource = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, { translation: translations[locale] }]),
);

function syncDocumentLanguage(language: string): void {
  document.documentElement.lang = language;
}

i18n.on('languageChanged', syncDocumentLanguage);

// Resources are bundled, so initialisation is synchronous: no flash of untranslated keys
// and no extra network request on a poor connection.
void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  defaultNS: 'translation',
  initAsync: false,
  interpolation: { escapeValue: false }, // React already escapes rendered values.
  returnNull: false,
});

syncDocumentLanguage(i18n.language);

/** Locale currently displayed. */
export function getCurrentLocale(): Locale {
  const current = i18n.resolvedLanguage ?? i18n.language;
  return isLocale(current) ? current : DEFAULT_LOCALE;
}

/** Switches the UI language and remembers the choice for the next visits. */
export async function changeLocale(locale: Locale): Promise<void> {
  persistLocale(locale);
  await i18n.changeLanguage(locale);
}

export { i18n };
export { LOCALE_NAMES } from './locales';
