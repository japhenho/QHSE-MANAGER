import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { CloseIcon, ShieldCheckIcon } from '../components/ui';
import { cx } from '../lib/cx';
import { NAV_ITEMS } from './navigation';

export const SIDEBAR_ID = 'app-sidebar';

interface SidebarProps {
  /** Mobile drawer state. On large screens the sidebar is always visible. */
  open: boolean;
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}

export function Sidebar({ open, onClose, closeButtonRef }: SidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      id={SIDEBAR_ID}
      // While open on a small screen the sidebar behaves as a modal drawer.
      role={open ? 'dialog' : undefined}
      aria-modal={open || undefined}
      aria-label={open ? t('nav.label') : undefined}
      className={cx(
        'fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col bg-chrome text-on-chrome',
        'transition-[translate,visibility] duration-200 ease-out',
        'lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:max-w-none lg:translate-x-0 lg:transition-none',
        // `invisible` removes the closed drawer from the tab order and the accessibility tree.
        open ? 'visible translate-x-0 shadow-drawer' : 'invisible -translate-x-full',
      )}
    >
      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-chrome-line px-4">
        <div className="flex min-w-0 items-center gap-3">
          <ShieldCheckIcon className="size-8 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="truncate text-lg leading-tight font-bold text-white">{t('app.name')}</p>
            <p className="truncate text-xs text-on-chrome-muted">{t('app.tagline')}</p>
          </div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t('nav.closeMenu')}
          className="focus-on-chrome inline-flex size-touch shrink-0 items-center justify-center rounded-control text-on-chrome hover:bg-chrome-raised lg:hidden"
        >
          <CloseIcon />
        </button>
      </div>

      <nav aria-label={t('nav.label')} className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ id, path, labelKey, icon: Icon, end }) => (
            <li key={id}>
              <NavLink
                to={path}
                end={end}
                onClick={onClose}
                className={({ isActive }) =>
                  cx(
                    'focus-on-chrome flex min-h-touch-lg items-center gap-3 rounded-control border-l-4 px-3 text-base font-medium',
                    isActive
                      ? 'border-accent bg-chrome-raised text-white'
                      : 'border-transparent text-on-chrome hover:bg-chrome-raised',
                  )
                }
              >
                <Icon className="size-6 shrink-0" />
                <span className="min-w-0 break-words">{t(labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
