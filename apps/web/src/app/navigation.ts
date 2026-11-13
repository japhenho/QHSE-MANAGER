import { ActivityIcon, HomeIcon, type IconComponent } from '../components/ui';
import type { Translation } from '../i18n/locales';

/**
 * Route paths of the application. Always reference these constants instead of
 * writing a path string in a component.
 */
export const ROUTES = {
  home: '/',
  systemStatus: '/system-status',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Navigation labels live under the `nav.*` translation keys, minus the chrome strings. */
type NavLabelKey = `nav.${Exclude<keyof Translation['nav'], 'label' | 'openMenu' | 'closeMenu'>}`;

export interface NavItem {
  /** Stable identifier (analytics, tests, future permission checks). */
  readonly id: string;
  readonly path: RoutePath;
  /** Translation key of the label — never a literal string. */
  readonly labelKey: NavLabelKey;
  readonly icon: IconComponent;
  /** Match the path exactly (needed for `/`, which prefixes every other path). */
  readonly end?: boolean;
}

/**
 * Single source of truth for the main navigation.
 *
 * A module appears here only once its route really exists: add the route in
 * `routes.tsx`, the label under `nav.*` in every locale file, then one entry below.
 * Never list a module that is not built yet.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', path: ROUTES.home, labelKey: 'nav.home', icon: HomeIcon, end: true },
  {
    id: 'system-status',
    path: ROUTES.systemStatus,
    labelKey: 'nav.systemStatus',
    icon: ActivityIcon,
  },
];
