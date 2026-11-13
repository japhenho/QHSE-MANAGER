import { jest } from '@jest/globals';
import { runInTenantContext, type TenantTransaction, uuidv7 } from '../tenancy/index.js';
import type { AuditEntry } from './audit-entry.js';
import { AuditEntryError, AuditService } from './audit.service.js';

const tenantId = uuidv7();
const userId = uuidv7();
const resourceId = uuidv7();

function setup() {
  const create = jest.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const tx = { auditEvent: { create } } as unknown as TenantTransaction;
  return { create, tx, service: new AuditService() };
}

const asUser = <T>(fn: () => Promise<T>) => runInTenantContext({ tenantId, userId }, fn);

describe('AuditService.record', () => {
  it('records a state transition with actor, statuses and reason', async () => {
    const { create, tx, service } = setup();

    await asUser(() =>
      service.record(tx, {
        action: 'incident.status_changed',
        resource: { type: 'incident', id: resourceId },
        transition: { from: 'SUBMITTED', to: 'REJECTED', reason: 'Incomplete description' },
      }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: 'incident.status_changed',
      resourceType: 'incident',
      resourceId,
      fromStatus: 'SUBMITTED',
      toStatus: 'REJECTED',
      reason: 'Incomplete description',
      metadata: {},
      requestId: null,
      sessionId: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it('never accepts an event time from the caller', async () => {
    const { create, tx, service } = setup();
    const entry = {
      action: 'auth.login_succeeded',
      occurredAt: new Date(0),
    } as unknown as AuditEntry;

    await expect(asUser(() => service.record(tx, entry))).rejects.toBeInstanceOf(AuditEntryError);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['without previous status', { to: 'CLOSED' }],
    ['without new status', { from: 'OPEN' }],
    ['with an empty previous status', { from: ' ', to: 'CLOSED' }],
    ['with an empty new status', { from: 'OPEN', to: '' }],
  ])('refuses a transition %s', async (_label, transition) => {
    const { create, tx, service } = setup();
    const entry = { action: 'capa.status_changed', transition } as unknown as AuditEntry;

    await expect(asUser(() => service.record(tx, entry))).rejects.toBeInstanceOf(AuditEntryError);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an event without actor: no user in the context and not declared as system', async () => {
    const { create, tx, service } = setup();

    await expect(
      runInTenantContext({ tenantId }, () => service.record(tx, { action: 'permit.expired' })),
    ).rejects.toThrow(/needs an actor/);
    expect(create).not.toHaveBeenCalled();
  });

  it('records a system event when explicitly declared', async () => {
    const { create, tx, service } = setup();

    await runInTenantContext({ tenantId }, () =>
      service.record(tx, { action: 'permit.expired', actor: 'system' }),
    );

    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      actorType: 'SYSTEM',
      actorUserId: null,
    });
  });

  it('refuses to attribute to the system an action done by a user', async () => {
    const { tx, service } = setup();
    await expect(
      asUser(() => service.record(tx, { action: 'permit.expired', actor: 'system' })),
    ).rejects.toBeInstanceOf(AuditEntryError);
  });

  it('refuses to run outside of a tenant context', async () => {
    const { tx, service } = setup();
    await expect(service.record(tx, { action: 'auth.login_succeeded' })).rejects.toThrow(
      /No tenant context/,
    );
  });

  it.each(['Incident Closed', 'incident', 'incident.', '.closed', 'incident.Closed', 'a b.c'])(
    'refuses the action key %p',
    async (action) => {
      const { tx, service } = setup();
      await expect(asUser(() => service.record(tx, { action }))).rejects.toBeInstanceOf(
        AuditEntryError,
      );
    },
  );

  it.each([
    [{ password: 'x' }, 'password'],
    [{ user: { accessToken: 'x' } }, 'user.accessToken'],
    [{ items: [{ api_key: 'x' }] }, 'items[0].api_key'],
    [{ Authorization: 'Bearer x' }, 'Authorization'],
  ])('refuses sensitive metadata %j', async (metadata, key) => {
    const { create, tx, service } = setup();
    await expect(
      asUser(() => service.record(tx, { action: 'auth.login_succeeded', metadata })),
    ).rejects.toThrow(key);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses oversized metadata', async () => {
    const { tx, service } = setup();
    await expect(
      asUser(() =>
        service.record(tx, { action: 'export.generated', metadata: { blob: 'x'.repeat(9000) } }),
      ),
    ).rejects.toThrow(/exceed/);
  });

  it('copies the request origin and drops a malformed IP address', async () => {
    const { create, tx, service } = setup();
    const sessionId = uuidv7();

    await runInTenantContext(
      {
        tenantId,
        userId,
        request: {
          requestId: 'req-1',
          sessionId,
          ipAddress: 'not-an-ip',
          userAgent: 'u'.repeat(600),
        },
      },
      () =>
        service.record(tx, { action: 'export.generated', metadata: { format: 'csv', rows: 12 } }),
    );

    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      requestId: 'req-1',
      sessionId,
      ipAddress: null,
      userAgent: 'u'.repeat(512),
      metadata: { format: 'csv', rows: 12 },
    });
  });

  it('propagates a write failure so that the business change is rolled back', async () => {
    const { create, tx, service } = setup();
    create.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      asUser(() => service.record(tx, { action: 'auth.login_succeeded' })),
    ).rejects.toThrow('insert failed');
  });
});
