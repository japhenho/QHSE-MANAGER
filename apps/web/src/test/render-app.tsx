import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router-dom';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createQueryClient } from '../lib/api';

/** Renders the real application (shell, routes, providers) at the given URL. */
export function renderApp(initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const queryClient = createQueryClient();
  const user = userEvent.setup();
  return { user, router, ...render(<App router={router} queryClient={queryClient} />) };
}

/** Builds a JSON `Response` like the API would send. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
