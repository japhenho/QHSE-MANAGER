import { type CompanyView, PERMISSIONS, type SiteView } from '@qhse/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../i18n/locales';
import { identityWith, jsonResponse, renderApp } from '../../test/render-app';

const fr = translations.fr.organization;
const en = translations.en.organization;

const COMPANY: CompanyView = {
  id: '0193a000-0000-7000-8000-0000000000c1',
  code: 'ACME-CG',
  name: 'ACME Congo',
  version: 2,
  createdAt: '2026-11-13T10:00:00.000Z',
  archivedAt: null,
};
const SITE: SiteView = {
  id: '0193a000-0000-7000-8000-0000000000s1',
  companyId: COMPANY.id,
  companyName: COMPANY.name,
  code: 'DJENO',
  name: 'Terminal de Djeno',
  countryCode: 'CG',
  timeZone: 'Africa/Brazzaville',
  currencyCode: 'XAF',
  version: 4,
  createdAt: '2026-11-13T10:00:00.000Z',
  archivedAt: null,
};

const page = <T,>(items: T[]) =>
  jsonResponse({ items, page: 1, pageSize: 25, total: items.length });
const conflict = (reason: string) =>
  jsonResponse({ code: 'CONFLICT', message: 'developer message', details: { reason } }, 409);

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}

function stubApi(handlers: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const call: Call = {
        method: init.method ?? 'GET',
        path: url.pathname.replace('/api/v1', ''),
        search: url.searchParams,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const handler = handlers[`${call.method} ${call.path}`];
      if (!handler) throw new Error(`Unexpected API call: ${call.method} ${call.path}`);
      return handler(call);
    }),
  );
  return calls;
}

const READ_ONLY = {
  status: 'authenticated',
  identity: identityWith([PERMISSIONS.ORGANIZATION_READ]),
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('organisation lists', () => {
  it('opens on the companies and switches between the three lists', async () => {
    stubApi({
      'GET /companies': () => page([COMPANY]),
      'GET /sites': () => page([SITE]),
      'GET /departments': () => page([]),
    });
    const { user, router } = renderApp('/organization');

    expect(await screen.findByRole('link', { name: 'ACME Congo' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/organization/companies');

    const tabs = screen.getByRole('navigation', { name: fr.tabsLabel });
    await user.click(within(tabs).getByRole('link', { name: fr.sites.tab }));
    expect(await screen.findByRole('link', { name: 'Terminal de Djeno' })).toBeInTheDocument();

    // Each list is its own page: the tabs were re-rendered.
    await user.click(
      within(screen.getByRole('navigation', { name: fr.tabsLabel })).getByRole('link', {
        name: fr.departments.tab,
      }),
    );
    expect(await screen.findByText(fr.departments.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(fr.departments.emptyBody)).toBeInTheDocument();
  });

  it('shows a site with its company, country in the user language, time zone and currency', async () => {
    stubApi({ 'GET /sites': () => page([SITE]), 'GET /companies': () => page([COMPANY]) });
    const { user } = renderApp('/organization/sites');

    const row = (await screen.findByRole('link', { name: 'Terminal de Djeno' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('DJENO')).toBeInTheDocument();
    expect(within(row).getByText('ACME Congo')).toBeInTheDocument();
    expect(within(row).getByText('Congo-Brazzaville')).toBeInTheDocument();
    expect(within(row).getByText('Africa/Brazzaville')).toBeInTheDocument();
    expect(within(row).getByText('XAF')).toBeInTheDocument();
    expect(within(row).getByText(fr.statusActive)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await within(row).findByText('Congo - Brazzaville')).toBeInTheDocument();
    expect(within(row).getByText(en.statusActive)).toBeInTheDocument();
  });

  it('sorts by a column and reverses on a second click', async () => {
    const calls = stubApi({ 'GET /companies': () => page([COMPANY]) });
    const { user } = renderApp('/organization/companies');
    await screen.findByRole('table');

    const sortByCode = screen.getByRole('button', {
      name: fr.sortBy.replace('{{column}}', fr.fields.code),
    });
    await user.click(sortByCode);
    await waitFor(() => expect(calls.at(-1)?.search.get('sort')).toBe('code'));
    expect(calls.at(-1)?.search.get('order')).toBe('asc');
    expect(sortByCode.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await user.click(sortByCode);
    await waitFor(() => expect(calls.at(-1)?.search.get('order')).toBe('desc'));
    expect(sortByCode.closest('th')).toHaveAttribute('aria-sort', 'descending');
  });

  it('hides archived records by default and shows them on request', async () => {
    const calls = stubApi({
      'GET /companies': (call) =>
        page(
          call.search.get('status') === 'archived'
            ? [{ ...COMPANY, archivedAt: '2026-11-14T00:00:00.000Z' }]
            : [],
        ),
    });
    const { user } = renderApp('/organization/companies');

    expect(await screen.findByText(fr.companies.emptyTitle)).toBeInTheDocument();
    expect(calls[0]?.search.get('status')).toBe('active');

    await user.selectOptions(screen.getByLabelText(fr.filters.status), fr.filters.archived);
    const row = (await screen.findByRole('link', { name: 'ACME Congo' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText(fr.statusArchived)).toBeInTheDocument();
  });

  it('searches, and filters sites by company', async () => {
    const calls = stubApi({
      'GET /sites': () => page([SITE]),
      'GET /companies': () => page([COMPANY]),
    });
    const { user } = renderApp('/organization/sites');
    await screen.findByRole('table');

    await user.type(screen.getByLabelText(fr.filters.search), 'djeno');
    await user.click(screen.getByRole('button', { name: fr.filters.searchSubmit }));
    await waitFor(() => expect(calls.at(-1)?.search.get('search')).toBe('djeno'));

    await user.selectOptions(screen.getByLabelText(fr.fields.company), 'ACME Congo');
    await waitFor(() => expect(calls.at(-1)?.search.get('companyId')).toBe(COMPANY.id));
    expect(calls.at(-1)?.search.get('page')).toBe('1');
  });

  it('offers no "new" button to a user who may only read', async () => {
    stubApi({ 'GET /companies': () => page([COMPANY]) });
    renderApp('/organization/companies', READ_ONLY);
    await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: fr.companies.create })).not.toBeInTheDocument();
  });
});

describe('organisation forms', () => {
  it('creates a site with a country, a time zone and a currency chosen from reference lists', async () => {
    const calls = stubApi({
      'GET /companies': () => page([COMPANY]),
      'POST /sites': () => jsonResponse(SITE, 201),
      [`GET /sites/${SITE.id}`]: () => jsonResponse(SITE),
    });
    const { user, router } = renderApp('/organization/sites/new');

    await screen.findByRole('option', { name: 'ACME Congo' });
    await user.selectOptions(screen.getByLabelText(fr.fields.company), 'ACME Congo');
    await user.type(screen.getByLabelText(fr.fields.code), 'djeno');
    await user.type(screen.getByLabelText(fr.fields.name), 'Terminal de Djeno');
    await user.selectOptions(screen.getByLabelText(fr.fields.country), 'Congo-Brazzaville');
    await user.selectOptions(screen.getByLabelText(fr.fields.timeZone), 'Africa/Brazzaville');
    await user.selectOptions(screen.getByLabelText(fr.fields.currency), 'XAF');
    await user.click(screen.getByRole('button', { name: fr.save }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/organization/sites/${SITE.id}`),
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      companyId: COMPANY.id,
      code: 'DJENO',
      name: 'Terminal de Djeno',
      countryCode: 'CG',
      timeZone: 'Africa/Brazzaville',
      currencyCode: 'XAF',
    });
  });

  it('points at every missing field before calling the API', async () => {
    const calls = stubApi({ 'GET /companies': () => page([COMPANY]) });
    const { user } = renderApp('/organization/sites/new');

    await user.click(await screen.findByRole('button', { name: fr.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.invalid);
    for (const message of Object.values(fr.fieldErrors).filter(
      (text) => text !== fr.fieldErrors.siteId,
    )) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(fr.fields.country)).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('edits a record sending only what changed with the version, and explains a conflict', async () => {
    const calls = stubApi({
      [`GET /sites/${SITE.id}`]: () => jsonResponse(SITE),
      [`PATCH /sites/${SITE.id}`]: () => conflict('stale_version'),
    });
    const { user } = renderApp(`/organization/sites/${SITE.id}`);

    const name = await screen.findByLabelText(fr.fields.name);
    expect(name).toHaveValue('Terminal de Djeno');
    // The company is fixed at creation.
    expect(screen.getByLabelText(fr.fields.company)).toBeDisabled();
    expect(screen.getByLabelText(fr.fields.company)).toHaveValue('ACME Congo');
    // Nothing to save yet.
    expect(screen.getByRole('button', { name: fr.save })).toBeDisabled();

    await user.clear(name);
    await user.type(name, 'Terminal Djeno Nord');
    await user.click(screen.getByRole('button', { name: fr.save }));

    expect(await screen.findByText(fr.errors.stale_version)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Terminal Djeno Nord',
      version: 4,
    });
  });

  it('explains a code already in use', async () => {
    stubApi({ 'POST /companies': () => conflict('code_taken') });
    const { user } = renderApp('/organization/companies/new');

    await user.type(await screen.findByLabelText(fr.fields.code), 'ACME-CG');
    await user.type(screen.getByLabelText(fr.fields.name), 'ACME bis');
    await user.click(screen.getByRole('button', { name: fr.save }));

    expect(await screen.findByText(fr.errors.code_taken)).toBeInTheDocument();
  });

  it('archives after confirmation, and explains why a parent with active children cannot be archived', async () => {
    const calls = stubApi({
      [`GET /companies/${COMPANY.id}`]: () => jsonResponse(COMPANY),
      [`POST /companies/${COMPANY.id}/archive`]: () => conflict('has_active_children'),
    });
    const { user } = renderApp(`/organization/companies/${COMPANY.id}`);

    await user.click(await screen.findByRole('button', { name: fr.archive }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(
      screen.getByText(fr.archiveConfirm.replace('{{name}}', 'ACME Congo')),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: fr.archiveConfirmYes }));
    expect(await screen.findByText(fr.errors.has_active_children)).toBeInTheDocument();
  });

  it('an archived record is read-only and can be restored', async () => {
    const archived = { ...COMPANY, archivedAt: '2026-11-14T00:00:00.000Z', version: 3 };
    const calls = stubApi({
      [`GET /companies/${COMPANY.id}`]: () => jsonResponse(archived),
      [`POST /companies/${COMPANY.id}/restore`]: () => jsonResponse({ ...COMPANY, version: 4 }),
    });
    const { user } = renderApp(`/organization/companies/${COMPANY.id}`);

    expect(await screen.findByText(fr.archivedNotice)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.fields.name)).toBeDisabled();
    expect(screen.queryByRole('button', { name: fr.save })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.archive })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: fr.restore }));

    await waitFor(() => expect(screen.getByLabelText(fr.fields.name)).toBeEnabled());
    expect(calls.some((call) => call.path.endsWith('/restore'))).toBe(true);
    expect(screen.queryByText(fr.archivedNotice)).not.toBeInTheDocument();
  });

  it('a user who may only read sees the record without any action', async () => {
    stubApi({ [`GET /companies/${COMPANY.id}`]: () => jsonResponse(COMPANY) });
    renderApp(`/organization/companies/${COMPANY.id}`, READ_ONLY);

    expect(await screen.findByText(fr.readOnly)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.fields.name)).toBeDisabled();
    expect(screen.queryByRole('button', { name: fr.save })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.archive })).not.toBeInTheDocument();
  });

  it('opening the creation form without the right to manage shows "access denied"', async () => {
    const calls = stubApi({});
    renderApp('/organization/companies/new', READ_ONLY);
    expect(
      await screen.findByRole('heading', { level: 1, name: translations.fr.access.forbiddenTitle }),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });
});

describe('unsaved changes', () => {
  const handlers = {
    [`GET /companies/${COMPANY.id}`]: () => jsonResponse(COMPANY),
    'GET /companies': () => page([COMPANY]),
  };

  it('asks before leaving a form with unsaved input, and stays on request', async () => {
    stubApi(handlers);
    const { user, router } = renderApp(`/organization/companies/${COMPANY.id}`);

    await user.type(await screen.findByLabelText(fr.fields.name), ' SA');
    await user.click(screen.getByRole('link', { name: fr.companies.back }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(fr.unsaved.title);
    expect(router.state.location.pathname).toBe(`/organization/companies/${COMPANY.id}`);

    await user.click(within(dialog).getByRole('button', { name: fr.unsaved.stay }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(fr.fields.name)).toHaveValue('ACME Congo SA');
  });

  it('leaves when the user confirms', async () => {
    stubApi(handlers);
    const { user, router } = renderApp(`/organization/companies/${COMPANY.id}`);

    await user.type(await screen.findByLabelText(fr.fields.name), ' SA');
    await user.click(screen.getByRole('link', { name: fr.companies.back }));
    await user.click(await screen.findByRole('button', { name: fr.unsaved.leave }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/organization/companies'));
  });

  it('does not ask when nothing was changed', async () => {
    stubApi(handlers);
    const { user, router } = renderApp(`/organization/companies/${COMPANY.id}`);

    await screen.findByLabelText(fr.fields.name);
    await user.click(screen.getByRole('link', { name: fr.companies.back }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/organization/companies'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('warns the browser before a reload or a tab close only while there is unsaved input', async () => {
    stubApi(handlers);
    const { user } = renderApp(`/organization/companies/${COMPANY.id}`);
    const name = await screen.findByLabelText(fr.fields.name);

    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await user.type(name, ' SA');
    expect(fire()).toBe(true);
  });
});
