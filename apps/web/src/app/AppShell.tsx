import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const MAIN_ID = 'main-content';
/** Must match the Tailwind `lg` breakpoint, above which the sidebar is permanently visible. */
const DESKTOP_MEDIA_QUERY = '(min-width: 64rem)';

/** Application frame shared by every page: sidebar, top bar and the routed content. */
export function AppShell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigation = useNavigation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const restoreFocusToMenu = useRef(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  /**
   * Closes the drawer and returns focus to the button that opened it. When the close is
   * caused by a navigation, the route-change effect below then moves focus to the new page.
   */
  const dismissDrawer = useCallback(() => {
    setDrawerOpen((open) => {
      if (open) restoreFocusToMenu.current = true;
      return false;
    });
  }, []);

  // Drawer focus management and Escape key.
  useEffect(() => {
    if (!drawerOpen) {
      if (restoreFocusToMenu.current) {
        restoreFocusToMenu.current = false;
        menuButtonRef.current?.focus();
      }
      return;
    }
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissDrawer();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, dismissDrawer]);

  // The drawer only exists below the desktop breakpoint: close it when the viewport grows.
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP_MEDIA_QUERY);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // After a navigation, move focus to the new page so keyboard and screen-reader users land on it.
  const previousPathname = useRef(pathname);
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    mainRef.current?.focus();
    window.scrollTo?.({ top: 0 });
  }, [pathname]);

  const routeLoading = navigation.state === 'loading';

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href={`#${MAIN_ID}`}
        className="sr-only z-50 rounded-control bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('app.skipToContent')}
      </a>

      {drawerOpen ? (
        <div
          aria-hidden="true"
          onClick={dismissDrawer}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}

      <Sidebar open={drawerOpen} onClose={dismissDrawer} closeButtonRef={closeButtonRef} />

      {/* `inert` keeps focus and assistive technologies inside the open drawer. */}
      <div inert={drawerOpen} className="flex min-h-dvh min-w-0 flex-col">
        <TopBar drawerOpen={drawerOpen} onOpenDrawer={openDrawer} menuButtonRef={menuButtonRef} />
        <div
          role="progressbar"
          aria-label={t('app.loading')}
          hidden={!routeLoading}
          className="h-1 animate-pulse bg-accent"
        />
        <main id={MAIN_ID} ref={mainRef} tabIndex={-1} className="flex-1">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
