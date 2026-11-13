import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp } from '../test/render-app';
import { LOCALE_STORAGE_KEY, detectLocale } from './locale-storage';
import { translations } from './locales';

describe('language switching', () => {
  it('renders French by default and switches every visible text and <html lang> to English', async () => {
    const { user } = renderApp('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: translations.fr.home.title }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'fr');
    expect(screen.getByText(translations.fr.home.foundationTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const switcher = screen.getByRole('group', { name: translations.fr.language.label });
    await user.click(within(switcher).getByRole('button', { name: 'English' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: translations.en.home.title }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(screen.getByText(translations.en.home.foundationTitle)).toBeInTheDocument();
    expect(screen.queryByText(translations.fr.home.foundationTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: translations.en.nav.label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.title).toContain(translations.en.home.title);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('translates pages that load data too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'ok' })),
    );
    const { user } = renderApp('/system-status');

    expect(await screen.findByText(translations.fr.systemStatus.summary.ok)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByText(translations.en.systemStatus.summary.ok)).toBeInTheDocument();
  });
});

describe('detectLocale', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefers the stored choice', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    expect(detectLocale()).toBe('en');
  });

  it('falls back to the first supported browser language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-BR', 'en-GB', 'fr']);
    expect(detectLocale()).toBe('en');
  });

  it('defaults to French when nothing matches or the stored value is invalid', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'xx');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    expect(detectLocale()).toBe('fr');
  });
});

describe('translation files', () => {
  it('have no empty string', () => {
    const emptyKeys: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (node.trim() === '') emptyKeys.push(path);
      } else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
      }
    };
    for (const [locale, tree] of Object.entries(translations)) walk(tree, locale);
    expect(emptyKeys).toEqual([]);
  });
});
