import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteObject } from 'react-router-dom';
import { LoadingState } from '../components/ui';
import { AppShell } from './AppShell';
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

/** Route table shared by the browser router and the tests (memory router). */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    ErrorBoundary: RouteError,
    HydrateFallback: PageLoading,
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
          { path: '*', ...lazyPage(() => import('../features/not-found/NotFoundPage')) },
        ],
      },
    ],
  },
];
