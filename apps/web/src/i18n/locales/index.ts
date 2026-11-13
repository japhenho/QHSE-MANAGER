import type { Locale } from '@qhse/shared';
import { en } from './en';
import { fr } from './fr';
import type { Translation } from './types';

/**
 * Locale registry.
 *
 * Typed as `Record<Locale, …>`: when a locale is added to `SUPPORTED_LOCALES` in
 * `@qhse/shared` (e.g. Portuguese), this file stops compiling until the matching
 * translation file and display name are registered here.
 */
export const translations: Record<Locale, Translation> = { fr, en };

/** Language names shown in the switcher, each written in its own language (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
};

export type { Translation };
