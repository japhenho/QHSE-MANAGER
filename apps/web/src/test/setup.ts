import '@testing-library/jest-dom/vitest';
import { onlineManager } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { i18n } from '../i18n';

beforeEach(async () => {
  window.localStorage.clear();
  // jsdom reports `en-US` as browser language; tests start from the product default.
  await i18n.changeLanguage('fr');
  // jsdom does not implement scrolling.
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.useRealTimers();
});
