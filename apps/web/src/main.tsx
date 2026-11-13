import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/index.css';
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { ConfigErrorScreen } from './app/ConfigErrorScreen';
import { routes } from './app/routes';
import { ConfigError, createQueryClient, getApiBaseUrl } from './lib/api';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}
const root = createRoot(container);

/** Validates the environment once, before anything can call the API. */
function readConfigError(): ConfigError | undefined {
  try {
    getApiBaseUrl();
    return undefined;
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
}

const configError = readConfigError();

root.render(
  <StrictMode>
    {configError ? (
      <ConfigErrorScreen variable={configError.variable} />
    ) : (
      <App router={createBrowserRouter(routes)} queryClient={createQueryClient()} />
    )}
  </StrictMode>,
);
