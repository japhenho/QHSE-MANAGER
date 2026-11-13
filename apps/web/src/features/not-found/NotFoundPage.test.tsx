import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { translations } from '../../i18n/locales';
import { renderApp } from '../../test/render-app';

const fr = translations.fr;

describe('404 route', () => {
  it('shows the not-found page inside the shell for an unknown URL', async () => {
    const { user } = renderApp('/this/page/does-not-exist');

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: fr.nav.label })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: fr.common.backToHome }));

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.home.title }),
    ).toBeInTheDocument();
  });
});
