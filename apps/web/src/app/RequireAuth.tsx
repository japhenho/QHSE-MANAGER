import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '../components/ui';
import { useAuth } from '../lib/auth';
import { ROUTES } from './navigation';

/** Where the user wanted to go before being sent to the login screen. */
export interface LoginRedirectState {
  from?: string;
}

/**
 * Gate in front of every page of the application: without a session the user is sent
 * to the login screen. This is a convenience for the user, not a security control —
 * the API refuses every unauthenticated request by itself.
 */
export function RequireAuth() {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <LoadingState label={t('auth.restoring')} />;
  if (auth.status === 'anonymous') {
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to={ROUTES.login} replace state={state} />;
  }
  return <Outlet />;
}
