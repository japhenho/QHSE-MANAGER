import { DEFAULT_LOCALE, isLocale, type Locale } from '@qhse/shared';

export const LOCALE_STORAGE_KEY = 'qhse.locale';

function readStoredLocale(): Locale | undefined {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : undefined;
  } catch {
    // Storage can be unavailable (private mode, restricted WebView).
    return undefined;
  }
}

function readBrowserLocale(): Locale | undefined {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const base = candidate?.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return undefined;
}

/** Explicit user choice first, then the browser preference, then the product default (French). */
export function detectLocale(): Locale {
  return readStoredLocale() ?? readBrowserLocale() ?? DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Non-blocking: the choice simply will not survive a reload.
  }
}
