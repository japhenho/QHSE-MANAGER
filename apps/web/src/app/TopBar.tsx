import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, MenuIcon, WifiOffIcon } from '../components/ui';
import { signOut, useAuth } from '../lib/auth';
import { useOnlineStatus } from '../lib/hooks/useOnlineStatus';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SIDEBAR_ID } from './Sidebar';

interface TopBarProps {
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

export function TopBar({ drawerOpen, onOpenDrawer, menuButtonRef }: TopBarProps) {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const auth = useAuth();
  const identity = auth.status === 'authenticated' ? auth.identity : undefined;

  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-line bg-surface px-3 sm:px-6">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenDrawer}
        aria-label={t('nav.openMenu')}
        aria-expanded={drawerOpen}
        aria-controls={SIDEBAR_ID}
        className="inline-flex size-touch shrink-0 items-center justify-center rounded-control text-fg hover:bg-surface-sunken lg:hidden"
      >
        <MenuIcon />
      </button>
      <p className="min-w-0 truncate text-lg font-bold text-fg lg:hidden">{t('app.name')}</p>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Kept mounted so screen readers announce connectivity changes. */}
        <div role="status">
          {online ? null : (
            <Badge tone="warning" icon={<WifiOffIcon className="size-4 shrink-0" />}>
              {t('app.offline')}
            </Badge>
          )}
        </div>
        {identity ? (
          <p
            className="hidden min-w-0 flex-col text-right leading-tight md:flex"
            title={t('auth.signedInAs', { email: identity.user.email })}
          >
            <span className="truncate font-semibold text-fg">{identity.tenant.name}</span>
            <span className="truncate font-mono text-sm text-fg-muted">{identity.user.email}</span>
          </p>
        ) : null}
        <LanguageSwitcher />
        {identity ? (
          <Button variant="secondary" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
