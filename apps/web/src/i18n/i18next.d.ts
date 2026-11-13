import 'i18next';
import type { fr } from './locales/fr';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    /** Keys are checked against the French reference: an unknown key is a compile error. */
    resources: { translation: typeof fr };
  }
}
