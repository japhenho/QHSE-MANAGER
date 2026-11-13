import { loginRequestSchema } from '@qhse/shared';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { LanguageSwitcher } from '../../app/LanguageSwitcher';
import { ROUTES } from '../../app/navigation';
import type { LoginRedirectState } from '../../app/RequireAuth';
import { Button, LoadingState, ShieldCheckIcon } from '../../components/ui';
import { isApiRequestError } from '../../lib/api';
import { signIn, useAuth } from '../../lib/auth';
import { describeError } from '../../lib/errors';
import { usePageTitle } from '../../lib/hooks/usePageTitle';

const ORGANIZATION_STORAGE_KEY = 'qhse.organization';
type Field = 'organization' | 'email' | 'password';

/** The organisation code is not a secret: remembering it saves typing on every visit. */
function readRememberedOrganization(): string {
  try {
    return window.localStorage.getItem(ORGANIZATION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberOrganization(value: string): void {
  try {
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, value);
  } catch {
    // Storage unavailable (private mode): the field simply starts empty next time.
  }
}

/** Only in-app paths are accepted as a destination after login. */
function safeDestination(state: unknown): string {
  const from = (state as LoginRedirectState | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    ? from
    : ROUTES.home;
}

const INPUT_CLASSES =
  'min-h-touch-lg w-full rounded-control border-2 border-line-strong bg-surface-sunken px-3 text-base text-fg ' +
  'placeholder:text-fg-muted aria-invalid:border-danger';

export default function LoginPage() {
  const { t } = useTranslation();
  usePageTitle(t('auth.title'));
  const auth = useAuth();
  const location = useLocation();
  const formId = useId();

  const [organization, setOrganization] = useState(readRememberedOrganization);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<Field>>(new Set());
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'loading') return <LoadingState label={t('auth.restoring')} />;
  if (auth.status === 'authenticated') {
    return <Navigate to={safeDestination(location.state)} replace />;
  }

  function describeFailure(error: unknown): string {
    if (isApiRequestError(error) && error.kind === 'http') {
      if (error.status === 401) return t('auth.errors.invalidCredentials');
      if (error.status === 429) {
        const details = error.apiError?.details as { retryAfterSeconds?: unknown } | undefined;
        const seconds =
          typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : 60;
        return t('auth.errors.tooManyAttempts', { count: Math.max(1, Math.ceil(seconds / 60)) });
      }
      if (error.status === 400) return t('auth.errors.invalidForm');
      if (error.status !== undefined && error.status >= 500) return t('errors.server');
    }
    return describeError(error, t);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(undefined);

    const parsed = loginRequestSchema.safeParse({ organization, email, password });
    if (!parsed.success) {
      setInvalidFields(new Set(parsed.error.issues.map((issue) => issue.path[0] as Field)));
      setFormError(t('auth.errors.invalidForm'));
      return;
    }
    setInvalidFields(new Set());

    setSubmitting(true);
    try {
      await signIn(parsed.data);
      rememberOrganization(parsed.data.organization);
      // The store is now "authenticated": this component re-renders and redirects.
    } catch (error) {
      setPassword('');
      setFormError(describeFailure(error));
    } finally {
      setSubmitting(false);
    }
  }

  const field = (name: Field) => ({
    id: `${formId}-${name}`,
    name,
    className: INPUT_CLASSES,
    'aria-invalid': invalidFields.has(name) || undefined,
    'aria-describedby': invalidFields.has(name) ? `${formId}-${name}-error` : undefined,
    disabled: submitting,
    required: true,
  });

  const fieldError = (name: Field) =>
    invalidFields.has(name) ? (
      <p id={`${formId}-${name}-error`} className="text-sm text-danger-fg">
        {t(`auth.fieldErrors.${name}`)}
      </p>
    ) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <ShieldCheckIcon className="size-8 shrink-0 text-accent" />
          <p className="truncate font-display text-xl font-bold text-fg">{t('app.name')}</p>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:py-10">
        <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-card sm:p-8">
          <h1 className="text-3xl font-bold text-fg">{t('auth.title')}</h1>
          <p className="mt-1 text-fg-muted">{t('auth.subtitle')}</p>

          <form
            noValidate
            onSubmit={(event) => void onSubmit(event)}
            className="mt-6 flex flex-col gap-5"
          >
            {/* Kept mounted so screen readers announce the error when it appears. */}
            <div role="alert">
              {formError ? (
                <p className="rounded-control border-2 border-danger bg-danger-surface px-3 py-2 font-medium text-danger-fg">
                  {formError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${formId}-organization`} className="font-semibold text-fg">
                {t('auth.organization')}
              </label>
              <input
                {...field('organization')}
                type="text"
                autoComplete="organization"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
              />
              <p className="text-sm text-fg-muted">{t('auth.organizationHint')}</p>
              {fieldError('organization')}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${formId}-email`} className="font-semibold text-fg">
                {t('auth.email')}
              </label>
              <input
                {...field('email')}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {fieldError('email')}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${formId}-password`} className="font-semibold text-fg">
                {t('auth.password')}
              </label>
              <input
                {...field('password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {fieldError('password')}
            </div>

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              {submitting ? t('auth.submitting') : t('auth.submit')}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
