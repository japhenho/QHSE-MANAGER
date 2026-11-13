import type { Translation } from './types';

/** English translations. Must match the shape of the French reference (`Translation`). */
export const en: Translation = {
  app: {
    name: 'QHSE Manager',
    tagline: 'Quality · Health · Safety · Environment',
    skipToContent: 'Skip to main content',
    loading: 'Loading…',
    offline: 'Offline',
    pageTitle: '{{page}} — QHSE Manager',
  },
  nav: {
    label: 'Main navigation',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    home: 'Home',
    systemStatus: 'System status',
  },
  language: {
    label: 'Language',
  },
  common: {
    retry: 'Try again',
    reload: 'Reload page',
    backToHome: 'Back to home',
    reference: 'Reference: {{id}}',
  },
  errors: {
    title: 'Something went wrong',
    offline: 'You are offline. Check your connection and try again.',
    network: 'Unable to reach the server. Check your connection or the API address.',
    timeout: 'The server did not respond in time. The connection may be too slow.',
    server: 'The server encountered an error. Try again in a moment.',
    client: 'The request could not be processed.',
    invalidResponse: 'The server returned an unexpected response.',
    unexpected: 'An unexpected error occurred.',
    routeTitle: 'This page could not be displayed',
    routeDescription:
      'Loading failed, often because of an unstable connection. Reload the page to try again.',
    configTitle: 'Invalid configuration',
    configDescription:
      'The {{variable}} variable is missing or invalid. The application cannot reach the API. Fix the configuration and restart the application.',
  },
  home: {
    title: 'Home',
    description: 'QHSE platform for industrial operations.',
    foundationTitle: 'Technical foundation in place',
    foundationBody:
      'This version only contains the application foundations: navigation, design system, French and English interface, and the link to the API. No business data is managed yet.',
    foundationBadge: 'Phase 0',
    statusTitle: 'Link to the API',
    statusBody:
      'The “System status” page queries the API in real time and shows whether it can be reached.',
    statusLink: 'View system status',
    modulesTitle: 'Modules',
    modulesEmptyTitle: 'No module available yet',
    modulesEmptyBody: 'Business modules will appear here and in the menu as they are delivered.',
  },
  systemStatus: {
    title: 'System status',
    description: 'Live check of the link between this application and the API.',
    refresh: 'Check again',
    checking: 'Checking…',
    lastChecked: 'Last checked: {{time}}',
    apiUrl: 'API address',
    checksTitle: 'Checks',
    live: {
      title: 'Availability',
      description: 'The API responds to requests.',
    },
    ready: {
      title: 'Dependent services',
      description: 'The API and its dependencies (database) are ready to handle requests.',
    },
    state: {
      checking: 'Checking…',
      ok: 'Operational',
      notReady: 'Not ready',
      unreachable: 'Unreachable',
      offline: 'Offline',
      error: 'Error',
    },
    notReadyDetail:
      'The API responds, but at least one of its dependencies is not ready. Try again in a moment.',
    summary: {
      checking: 'Checking the link to the API…',
      ok: 'The API is reachable and ready.',
      degraded: 'The API is reachable but not ready.',
      down: 'The API is unreachable.',
      offline: 'This device is offline. The check will resume when the connection is back.',
    },
  },
  notFound: {
    title: 'Page not found',
    description: 'The requested address does not exist or is no longer available.',
  },
};
