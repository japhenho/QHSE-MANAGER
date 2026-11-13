import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { translations } from '../i18n/locales';
import { renderApp } from '../test/render-app';
import { NAV_ITEMS } from './navigation';

const fr = translations.fr;

/** Resolves a `nav.xxx` key against the French file, like the component does through i18next. */
function navLabel(labelKey: (typeof NAV_ITEMS)[number]['labelKey']): string {
  const key = labelKey.slice('nav.'.length) as keyof typeof fr.nav;
  return fr.nav[key];
}

describe('application shell', () => {
  it('renders exactly the navigation entries of the config, in order, with their targets', async () => {
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: fr.nav.label });

    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      NAV_ITEMS.map((item) => navLabel(item.labelKey)),
    );
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      NAV_ITEMS.map((item) => item.path),
    );
  });

  it('only lists entries that exist: every nav path resolves to a real page, not the 404', async () => {
    for (const item of NAV_ITEMS) {
      const { unmount } = renderApp(item.path);
      expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent(
        fr.notFound.title,
      );
      unmount();
    }
  });

  it('marks the current page and navigates through the links', async () => {
    const { user } = renderApp('/');
    const nav = await screen.findByRole('navigation', { name: fr.nav.label });
    await screen.findByRole('heading', { level: 1, name: fr.home.title });

    expect(within(nav).getByRole('link', { name: fr.nav.home })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const statusLink = within(nav).getByRole('link', { name: fr.nav.systemStatus });
    expect(statusLink).not.toHaveAttribute('aria-current');

    await user.click(statusLink);

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.systemStatus.title }),
    ).toBeInTheDocument();
    expect(statusLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('exposes the landmarks and a skip link', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: fr.app.skipToContent })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  it('opens the mobile drawer as a dialog and closes it with Escape, restoring focus', async () => {
    const { user } = renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    const menuButton = screen.getByRole('button', { name: fr.nav.openMenu });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(menuButton);

    const drawer = screen.getByRole('dialog', { name: fr.nav.label });
    expect(drawer).toHaveAttribute('id', menuButton.getAttribute('aria-controls'));
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByRole('button', { name: fr.nav.closeMenu })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton).toHaveFocus();
  });
});
