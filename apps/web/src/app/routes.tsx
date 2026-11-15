import { PERMISSIONS } from '@qhse/shared';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, type RouteObject } from 'react-router-dom';
import { LoadingState } from '../components/ui';
import { AppShell } from './AppShell';
import { RequireAuth } from './RequireAuth';
import { RequirePermission } from './RequirePermission';
import { ROUTES } from './navigation';
import { RouteError } from './RouteError';

function PageLoading() {
  const { t } = useTranslation();
  return <LoadingState label={t('app.loading')} />;
}

/**
 * Declares a lazily loaded page: its code is only downloaded when the route is visited.
 * The page module must `export default` its component.
 */
function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return {
    lazy: async () => ({ Component: (await load()).default }),
    HydrateFallback: PageLoading,
  } satisfies Partial<RouteObject>;
}

type OrganizationPages = typeof import('../features/organization/pages');

/** A page of the organisation module, loaded with the module on first visit. */
function organizationPage(name: keyof OrganizationPages) {
  return lazyPage(async () => ({
    default: (await import('../features/organization/pages'))[name],
  }));
}

/** Route table shared by the browser router and the tests (memory router). */
export const routes: RouteObject[] = [
  {
    path: ROUTES.login,
    ErrorBoundary: RouteError,
    ...lazyPage(() => import('../features/login/LoginPage')),
  },
  {
    // Everything below requires a session.
    element: <RequireAuth />,
    ErrorBoundary: RouteError,
    HydrateFallback: PageLoading,
    children: [
      {
        element: <AppShell />,
        ErrorBoundary: RouteError,
        children: [
          {
            // Page-level boundary: a failing page keeps the shell and its navigation usable.
            ErrorBoundary: RouteError,
            children: [
              { path: ROUTES.home, ...lazyPage(() => import('../features/home/HomePage')) },
              {
                path: ROUTES.systemStatus,
                ...lazyPage(() => import('../features/system-status/SystemStatusPage')),
              },
              {
                element: <RequirePermission permission={PERMISSIONS.ORGANIZATION_READ} />,
                children: [
                  {
                    path: ROUTES.organization,
                    element: <Navigate to={ROUTES.companies} replace />,
                  },
                  { path: ROUTES.companies, ...organizationPage('CompaniesPage') },
                  { path: ROUTES.company, ...organizationPage('CompanyFormPage') },
                  { path: ROUTES.sites, ...organizationPage('SitesPage') },
                  { path: ROUTES.site, ...organizationPage('SiteFormPage') },
                  { path: ROUTES.departments, ...organizationPage('DepartmentsPage') },
                  { path: ROUTES.department, ...organizationPage('DepartmentFormPage') },
                ],
              },
              {
                element: <RequirePermission permission={PERMISSIONS.ORGANIZATION_MANAGE} />,
                children: [
                  { path: ROUTES.companyNew, ...organizationPage('CompanyFormPage') },
                  { path: ROUTES.siteNew, ...organizationPage('SiteFormPage') },
                  { path: ROUTES.departmentNew, ...organizationPage('DepartmentFormPage') },
                ],
              },
              {
                element: <RequirePermission permission={PERMISSIONS.ROLE_READ} />,
                children: [
                  { path: ROUTES.roles, ...lazyPage(() => import('../features/access/RolesPage')) },
                  {
                    path: ROUTES.role,
                    ...lazyPage(() => import('../features/access/RoleEditorPage')),
                  },
                ],
              },
              {
                element: <RequirePermission permission={PERMISSIONS.ROLE_MANAGE} />,
                children: [
                  {
                    path: ROUTES.roleNew,
                    ...lazyPage(() => import('../features/access/RoleEditorPage')),
                  },
                ],
              },
              {
                element: <RequirePermission permission={PERMISSIONS.USER_READ} />,
                children: [
                  { path: ROUTES.users, ...lazyPage(() => import('../features/access/UsersPage')) },
                ],
              },
              {
                element: <RequirePermission permission={PERMISSIONS.AUDIT_LOG_READ} />,
                children: [
                  {
                    path: ROUTES.auditLog,
                    ...lazyPage(() => import('../features/access/AuditLogPage')),
                  },
                ],
              },
              { path: '*', ...lazyPage(() => import('../features/not-found/NotFoundPage')) },
            ],
          },
        ],
      },
    ],
  },
];
