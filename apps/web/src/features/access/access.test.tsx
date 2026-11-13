import { PERMISSIONS, type RoleSummary, type UserSummary } from '@qhse/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../i18n/locales';
import { identityWith, jsonResponse, renderApp, TEST_IDENTITY } from '../../test/render-app';

const fr = translations.fr;
const en = translations.en;

const ADMIN_ROLE: RoleSummary = {
  id: '0193a000-0000-7000-8000-0000000000r1',
  name: 'Administrateur',
  description: null,
  referenceKey: 'administrator',
  isSystem: true,
  permissions: Object.values(PERMISSIONS).sort(),
  assignedUserCount: 1,
  version: 1,
};
const SHIFT_ROLE: RoleSummary = {
  id: '0193a000-0000-7000-8000-0000000000r2',
  name: 'Chef de quart',
  description: 'Suit le journal',
  referenceKey: null,
  isSystem: false,
  permissions: ['audit-log:read'],
  assignedUserCount: 0,
  version: 3,
};
const USERS: UserSummary[] = [
  {
    ...TEST_IDENTITY.user,
    status: 'ACTIVE',
    roles: [
      { id: ADMIN_ROLE.id, name: 'Administrateur', referenceKey: 'administrator', isSystem: true },
    ],
  },
  {
    id: '0193a000-0000-7000-8000-0000000000u2',
    email: 'operator@example.test',
    status: 'ACTIVE',
    roles: [],
  },
];

const page = <T,>(items: T[]) =>
  jsonResponse({ items, page: 1, pageSize: 25, total: items.length });
const apiError = (status: number, code: string, reason?: string) =>
  jsonResponse(
    { code, message: 'developer message', ...(reason ? { details: { reason } } : {}) },
    status,
  );

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

/** Routes fetch calls by "METHOD /path"; an unexpected call fails the test. */
function stubApi(handlers: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const call: Call = {
        method: init.method ?? 'GET',
        path: url.pathname.replace('/api/v1', ''),
        search: url.search,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('navigation and access', () => {
  it('shows only the menu entries the user has the permission for', async () => {
    renderApp('/', {
      status: 'authenticated',
      identity: identityWith([PERMISSIONS.AUDIT_LOG_READ]),
    });
    const nav = await screen.findByRole('navigation', { name: fr.nav.label });

    expect(within(nav).getByRole('link', { name: fr.nav.auditLog })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.nav.roles })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.nav.users })).not.toBeInTheDocument();
  });

  it('opening a page without the permission shows "access denied" and calls nothing', async () => {
    const calls = stubApi({});
    renderApp('/roles', { status: 'authenticated', identity: identityWith([]) });

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.access.forbiddenTitle }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(fr.access.forbiddenBody);
    expect(calls).toEqual([]);
  });
});

describe('roles', () => {
  it('lists roles, translating the reference ones and keeping the names chosen by the tenant', async () => {
    stubApi({ 'GET /roles': () => page([ADMIN_ROLE, SHIFT_ROLE]) });
    const { user } = renderApp('/roles');

    const table = await screen.findByRole('table');
    expect(
      within(table).getByRole('link', { name: fr.access.referenceRoles.administrator }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Chef de quart' })).toBeInTheDocument();
    expect(within(table).getByText(fr.roles.systemBadge)).toBeInTheDocument();
    expect(
      within(table).getByText(fr.roles.permissionCount_one.replace('{{count}}', '1')),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(
      await within(table).findByRole('link', { name: en.access.referenceRoles.administrator }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Chef de quart' })).toBeInTheDocument();
  });

  it('shows loading, then an explicit empty state', async () => {
    stubApi({ 'GET /roles': () => page([]) });
    renderApp('/roles');
    expect(await screen.findByText(fr.roles.emptyTitle)).toBeInTheDocument();
  });

  it('shows an error with a retry that works', async () => {
    let attempt = 0;
    stubApi({
      'GET /roles': () => ((attempt += 1) === 1 ? apiError(403, 'FORBIDDEN') : page([SHIFT_ROLE])),
    });
    const { user } = renderApp('/roles');

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.access.errors.forbidden);
    await user.click(screen.getByRole('button', { name: fr.common.retry }));
    expect(await screen.findByRole('link', { name: 'Chef de quart' })).toBeInTheDocument();
  });

  it('hides "new role" from a user who may only read', async () => {
    stubApi({ 'GET /roles': () => page([SHIFT_ROLE]) });
    renderApp('/roles', {
      status: 'authenticated',
      identity: identityWith([PERMISSIONS.ROLE_READ]),
    });

    await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: fr.roles.create })).not.toBeInTheDocument();
  });

  it('creates a role for a job position with the chosen rights', async () => {
    const created = {
      ...SHIFT_ROLE,
      name: 'Magasinier',
      permissions: ['role:read', 'user:read'],
      version: 1,
    };
    const calls = stubApi({
      'POST /roles': () => jsonResponse(created, 201),
      [`GET /roles/${created.id}`]: () => jsonResponse(created),
    });
    const { user, router } = renderApp('/roles/new');

    await user.type(await screen.findByLabelText(fr.roles.name), '  Magasinier ');
    await user.click(screen.getByLabelText(new RegExp(fr.access.permissions.user_read)));
    await user.click(screen.getByLabelText(new RegExp(fr.access.permissions.role_read)));
    await user.click(screen.getByRole('button', { name: fr.roles.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/roles/${created.id}`));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Magasinier',
      permissions: ['role:read', 'user:read'],
    });
  });

  it('refuses an empty name before calling the API', async () => {
    const calls = stubApi({});
    const { user } = renderApp('/roles/new');

    await user.click(await screen.findByRole('button', { name: fr.roles.save }));

    expect(await screen.findByText(fr.roles.nameError)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('edits a role sending the version it read, and explains a conflict', async () => {
    const calls = stubApi({
      [`GET /roles/${SHIFT_ROLE.id}`]: () => jsonResponse(SHIFT_ROLE),
      [`PATCH /roles/${SHIFT_ROLE.id}`]: () => apiError(409, 'CONFLICT', 'stale_version'),
    });
    const { user } = renderApp(`/roles/${SHIFT_ROLE.id}`);

    const name = await screen.findByLabelText(fr.roles.name);
    expect(name).toHaveValue('Chef de quart');
    expect(screen.getByLabelText(new RegExp(fr.access.permissions.audit_log_read))).toBeChecked();
    await user.clear(name);
    await user.type(name, 'Chef de poste');
    await user.click(screen.getByRole('button', { name: fr.roles.save }));

    expect(await screen.findByText(fr.access.errors.stale_version)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Chef de poste',
      description: 'Suit le journal',
      permissions: ['audit-log:read'],
      version: 3,
    });
  });

  it('cannot tick a right the user does not hold', async () => {
    stubApi({});
    renderApp('/roles/new', {
      status: 'authenticated',
      identity: identityWith([PERMISSIONS.ROLE_READ, PERMISSIONS.ROLE_MANAGE]),
    });

    expect(
      await screen.findByLabelText(new RegExp(fr.access.permissions.audit_log_read)),
    ).toBeDisabled();
    expect(screen.getByLabelText(new RegExp(fr.access.permissions.role_read))).toBeEnabled();
    expect(screen.getAllByText(fr.roles.notHeld).length).toBeGreaterThan(0);
  });

  it('shows the administrator role read-only', async () => {
    stubApi({ [`GET /roles/${ADMIN_ROLE.id}`]: () => jsonResponse(ADMIN_ROLE) });
    renderApp(`/roles/${ADMIN_ROLE.id}`);

    expect(await screen.findByText(fr.roles.readOnlySystem)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.roles.name)).toBeDisabled();
    expect(screen.queryByRole('button', { name: fr.roles.save })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.roles.delete })).not.toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and explains why a role in use cannot be deleted', async () => {
    const calls = stubApi({
      [`GET /roles/${SHIFT_ROLE.id}`]: () => jsonResponse(SHIFT_ROLE),
      [`DELETE /roles/${SHIFT_ROLE.id}`]: () => apiError(409, 'CONFLICT', 'role_in_use'),
    });
    const { user } = renderApp(`/roles/${SHIFT_ROLE.id}`);

    await user.click(await screen.findByRole('button', { name: fr.roles.delete }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: fr.roles.deleteConfirmYes }));
    expect(await screen.findByText(fr.access.errors.role_in_use)).toBeInTheDocument();
  });
});

describe('users', () => {
  const handlers = {
    'GET /users': () => page(USERS),
    'GET /roles': () => page([ADMIN_ROLE, SHIFT_ROLE]),
  };

  it('lists users with their roles and assigns a role', async () => {
    const calls = stubApi({
      ...handlers,
      [`PUT /users/${USERS[1]?.id}/roles/${SHIFT_ROLE.id}`]: () =>
        new Response(null, { status: 204 }),
    });
    const { user } = renderApp('/users');

    expect(await screen.findByText('operator@example.test')).toBeInTheDocument();
    expect(screen.getByText(fr.users.noRole)).toBeInTheDocument();

    // One "add a role" control: none is offered on the user's own row.
    const selects = await screen.findAllByRole('combobox');
    expect(selects).toHaveLength(1);
    await user.selectOptions(selects[0] as HTMLElement, 'Chef de quart');
    await user.click(screen.getByRole('button', { name: fr.users.add }));

    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
  });

  it('explains why the last administrator cannot lose the role', async () => {
    stubApi({
      ...handlers,
      [`DELETE /users/${TEST_IDENTITY.user.id}/roles/${ADMIN_ROLE.id}`]: () =>
        apiError(409, 'CONFLICT', 'last_administrator'),
    });
    const { user } = renderApp('/users');

    await user.click(
      await screen.findByRole('button', {
        name: fr.users.removeRole
          .replace('{{role}}', fr.access.referenceRoles.administrator)
          .replace('{{email}}', TEST_IDENTITY.user.email),
      }),
    );

    expect(await screen.findByText(fr.access.errors.last_administrator)).toBeInTheDocument();
  });

  it('offers no assignment control to a user who may only read', async () => {
    stubApi({ 'GET /users': () => page(USERS) });
    renderApp('/users', {
      status: 'authenticated',
      identity: identityWith([PERMISSIONS.USER_READ]),
    });

    expect(await screen.findByText('operator@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retirer le rôle/ })).not.toBeInTheDocument();
  });

  it('searches by e-mail', async () => {
    const calls = stubApi(handlers);
    const { user } = renderApp('/users');

    await user.type(await screen.findByLabelText(fr.users.search), 'operator');
    await user.click(screen.getByRole('button', { name: fr.users.searchSubmit }));

    await waitFor(() =>
      expect(
        calls.some((call) => call.path === '/users' && call.search.includes('search=operator')),
      ).toBe(true),
    );
  });
});

describe('audit log', () => {
  const EVENT = {
    id: '0193a000-0000-7000-8000-0000000000e1',
    occurredAt: '2026-11-13T10:15:30.000Z',
    actorType: 'USER',
    actorUserId: TEST_IDENTITY.user.id,
    actorEmail: TEST_IDENTITY.user.email,
    action: 'role.created',
    resourceType: 'role',
    resourceId: SHIFT_ROLE.id,
    fromStatus: null,
    toStatus: null,
    reason: null,
    metadata: { name: 'Chef de quart' },
    ipAddress: '203.0.113.7',
  };
  const SYSTEM_EVENT = {
    ...EVENT,
    id: '0193a000-0000-7000-8000-0000000000e2',
    actorType: 'SYSTEM',
    actorUserId: null,
    actorEmail: null,
    action: 'incident.status_changed',
    fromStatus: 'SUBMITTED',
    toStatus: 'REJECTED',
    reason: 'Incomplet',
    metadata: {},
  };

  it('shows who did what and when, including transitions and system events', async () => {
    stubApi({ 'GET /audit-events': () => page([EVENT, SYSTEM_EVENT]) });
    renderApp('/audit-log');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('role.created')).toBeInTheDocument();
    expect(within(table).getByText(TEST_IDENTITY.user.email)).toBeInTheDocument();
    expect(within(table).getByText(fr.auditLog.system)).toBeInTheDocument();
    expect(within(table).getByText('SUBMITTED → REJECTED')).toBeInTheDocument();
    expect(within(table).getByText('Incomplet')).toBeInTheDocument();
    expect(table.querySelector('time')).toHaveAttribute('datetime', EVENT.occurredAt);
  });

  it('filters by action and shows an explicit empty state', async () => {
    const calls = stubApi({
      'GET /audit-events': (call) => (call.search.includes('action=') ? page([]) : page([EVENT])),
    });
    const { user } = renderApp('/audit-log');

    await screen.findByRole('table');
    await user.type(screen.getByLabelText(fr.auditLog.filterAction), 'role.deleted');
    await user.click(screen.getByRole('button', { name: fr.auditLog.apply }));

    expect(await screen.findByText(fr.auditLog.emptyTitle)).toBeInTheDocument();
    expect(calls.at(-1)?.search).toContain('action=role.deleted');
    expect(calls.at(-1)?.search).toContain('page=1');
  });

  it('offers no control to change or delete an event', async () => {
    stubApi({ 'GET /audit-events': () => page([EVENT]) });
    renderApp('/audit-log');

    const table = await screen.findByRole('table');
    expect(within(table).queryAllByRole('button')).toEqual([]);
  });
});
