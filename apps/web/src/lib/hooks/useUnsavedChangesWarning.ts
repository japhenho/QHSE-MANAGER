import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Protects a form with unsaved input against accidental loss:
 *  - leaving the site or reloading triggers the browser's own confirmation;
 *  - navigating inside the application is suspended until the user decides.
 *
 * `blocker.state === 'blocked'` → render a "stay / leave" prompt and call
 * `blocker.reset()` to stay or `blocker.proceed()` to leave.
 * `allowNextNavigation()` lets one navigation through: call it right before the form
 * itself navigates after a successful save (the input is saved, nothing is lost).
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  const bypassNext = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (bypassNext.current) {
      bypassNext.current = false;
      return false;
    }
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });

  const allowNextNavigation = useCallback(() => {
    bypassNext.current = true;
  }, []);

  return { blocker, allowNextNavigation };
}
