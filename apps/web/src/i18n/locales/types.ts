import type { fr } from './fr';

/** Recursively widens string literals so other locales can provide their own text. */
type TranslationShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};

/** Shape every locale file must satisfy: same keys as the French reference, no more, no less. */
export type Translation = TranslationShape<typeof fr>;
