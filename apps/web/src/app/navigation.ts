import { PERMISSIONS, type PermissionKey } from '@qhse/shared';
import {
  ActivityIcon,
  HomeIcon,
  type IconComponent,
  KeyIcon,
  ScrollIcon,
  UsersIcon,
} from '../components/ui';
import type { Translation } from '../i18n/locales';

/**
 * Route paths of the application. Always reference these constants instead of
 * writing a path string in a component.
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  systemStatus: '/system-status',
  roles: '/roles',
  roleNew: '/roles/new',
  role: '/roles/:id',
  users: '/users',
  auditLog: '/audit-log',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Navigation labels live under the `nav.*` translation keys, minus the chrome strings. */
type NavLabelKey = `nav.${Exclude<keyof Translation['nav'], 'label' | 'openMenu' | 'closeMenu'>}`;

export interface NavItem {
  /** Stable identifier (analytics, tests, future permission checks). */
  readonly id: string;
  readonly path: Exclude<
    RoutePath,
    typeof ROUTES.login | typeof ROUTES.role | typeof ROUTES.roleNew
  >;
  /** Translation key of the label — never a literal string. */
  readonly labelKey: NavLabelKey;
  readonly icon: IconComponent;
  /** Match the path exactly (needed for `/`, which prefixes every other path). */
  readonly end?: boolean;
  /**
   * Permission needed to see the entry. Hiding a menu is a courtesy to the user: the
   * server alone decides what is allowed.
   */
  readonly permission?: PermissionKey;
}

/** Path of one role's page. */
export function rolePath(id: string): string {
  return ROUTES.role.replace(':id', id);
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
  {
    id: 'roles',
    path: ROUTES.roles,
    labelKey: 'nav.roles',
    icon: KeyIcon,
    permission: PERMISSIONS.ROLE_READ,
  },
  {
    id: 'users',
    path: ROUTES.users,
    labelKey: 'nav.users',
    icon: UsersIcon,
    permission: PERMISSIONS.USER_READ,
  },
  {
    id: 'audit-log',
    path: ROUTES.auditLog,
    labelKey: 'nav.auditLog',
    icon: ScrollIcon,
    permission: PERMISSIONS.AUDIT_LOG_READ,
  },
];
