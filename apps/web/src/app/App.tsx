import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RouterProvider, type createBrowserRouter } from 'react-router-dom';
import { restoreSession } from '../lib/auth';

type AppRouter = ReturnType<typeof createBrowserRouter>;

interface AppProps {
  router: AppRouter;
  queryClient: QueryClient;
}

/** Root component: global providers around the router. i18n is initialised by importing `../i18n`. */
export function App({ router, queryClient }: AppProps) {
  // One silent attempt to resume the previous session (refresh cookie) at start-up.
  useEffect(() => {
    void restoreSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
