import type pg from 'pg';
import { AuditEntryError, AuditService } from '../src/audit/index.js';
import { runInTenantContext, TenantDatabase, uuidv7 } from '../src/tenancy/index.js';
import { createTestApp, type TestApp } from './create-test-app.js';
import { createAppClient, createOwnerClient, resetDatabase } from './support/db.js';
import { asTenant, seedTenant, sqlState, type TenantFixture } from './support/tenants.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

describe('audit log (ADR 0005)', () => {
  let app: TestApp;
  let db: TenantDatabase;
  let audit: AuditService;
  let owner: pg.Client;
  let runtime: pg.Client;
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    await resetDatabase();
    owner = createOwnerClient();
    runtime = createAppClient();
    await Promise.all([owner.connect(), runtime.connect()]);
    a = await seedTenant(owner, 'audit-alpha', 2);
    b = await seedTenant(owner, 'audit-bravo', 1);
    app = await createTestApp();
    db = app.get(TenantDatabase);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([owner.end(), runtime.end()]);
  });

  const asUserOf = <T>(tenant: TenantFixture, fn: () => Promise<T>): Promise<T> =>
    runInTenantContext({ tenantId: tenant.tenantId, userId: tenant.userIds[0] as string }, fn);

  /** Reads events as the owner, bound to a tenant (RLS is forced for the owner too). */
  async function eventsOf(tenant: TenantFixture, action?: string) {
    return asTenant(owner, tenant.tenantId, async () => {
      const result = await owner.query(
        `SELECT * FROM audit_events WHERE ($1::text IS NULL OR action = $1) ORDER BY occurred_at`,
        [action ?? null],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  it('stores a transition with actor, server time, statuses, reason and request origin', async () => {
    const resourceId = uuidv7();
    const sessionId = uuidv7();
    const before = new Date();

    await runInTenantContext(
      {
        tenantId: a.tenantId,
        userId: a.userIds[0] as string,
        request: { requestId: 'req-42', sessionId, ipAddress: '203.0.113.7', userAgent: 'jest' },
      },
      () =>
        db.run((tx) =>
          audit.record(tx, {
            action: 'incident.status_changed',
            resource: { type: 'incident', id: resourceId },
            transition: { from: 'SUBMITTED', to: 'REJECTED', reason: 'Incomplete' },
            metadata: { severity: 2 },
          }),
        ),
    );

    const [event] = await eventsOf(a, 'incident.status_changed');
    expect(event).toMatchObject({
      tenant_id: a.tenantId,
      actor_type: 'USER',
      actor_user_id: a.userIds[0],
      resource_type: 'incident',
      resource_id: resourceId,
      from_status: 'SUBMITTED',
      to_status: 'REJECTED',
      reason: 'Incomplete',
      metadata: { severity: 2 },
      request_id: 'req-42',
      session_id: sessionId,
      ip_address: '203.0.113.7',
      user_agent: 'jest',
    });
    const occurredAt = (event?.['occurred_at'] as Date).getTime();
    expect(occurredAt).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(occurredAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  describe('append-only', () => {
    let eventId: string;

    beforeAll(async () => {
      await asUserOf(a, () => db.run((tx) => audit.record(tx, { action: 'append.only_probe' })));
      const [event] = await eventsOf(a, 'append.only_probe');
      eventId = event?.['id'] as string;
    });

    it('the runtime role holds INSERT and SELECT only', async () => {
      const { rows } = await runtime.query<{ privilege: string; granted: boolean }>(
        `SELECT p AS privilege, has_table_privilege(current_user, 'audit_events', p) AS granted
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`,
      );
      expect(Object.fromEntries(rows.map((row) => [row.privilege, row.granted]))).toEqual({
        SELECT: true,
        INSERT: true,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
      });
    });

    it('runtime role: UPDATE is refused', async () => {
      const state = await sqlState(() =>
        asTenant(runtime, a.tenantId, () =>
          runtime.query(`UPDATE audit_events SET reason = 'tampered' WHERE id = $1`, [eventId]),
        ),
      );
      expect(state).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('runtime role: DELETE is refused', async () => {
      const state = await sqlState(() =>
        asTenant(runtime, a.tenantId, () =>
          runtime.query('DELETE FROM audit_events WHERE id = $1', [eventId]),
        ),
      );
      expect(state).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('runtime role: TRUNCATE is refused', async () => {
      expect(await sqlState(() => runtime.query('TRUNCATE TABLE audit_events'))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });

    it.each([
      ['UPDATE', `UPDATE audit_events SET reason = 'tampered'`],
      ['DELETE', 'DELETE FROM audit_events'],
    ])('second barrier: the trigger refuses %s even to the table owner', async (_op, statement) => {
      let message = '';
      const state = await sqlState(async () => {
        try {
          await asTenant(owner, a.tenantId, () => owner.query(statement));
        } catch (error) {
          message = (error as Error).message;
          throw error;
        }
      });
      expect(state).toBe(INSUFFICIENT_PRIVILEGE);
      expect(message).toContain('append-only');
    });

    it('second barrier: the trigger refuses TRUNCATE even to the table owner', async () => {
      let message = '';
      try {
        await owner.query('TRUNCATE TABLE audit_events');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('append-only');
    });

    it('the tenant client refuses to change or delete an event', async () => {
      await expect(
        asUserOf(a, () =>
          db.run((tx) =>
            tx.auditEvent.updateMany({ where: { id: eventId }, data: { reason: 'x' } }),
          ),
        ),
      ).rejects.toThrow(/append-only/);
      await expect(asUserOf(a, () => db.run((tx) => tx.auditEvent.deleteMany()))).rejects.toThrow(
        /append-only/,
      );
    });

    it('the event is still intact after all these attempts', async () => {
      const events = await eventsOf(a, 'append.only_probe');
      expect(events).toHaveLength(1);
      expect(events[0]?.['reason']).toBeNull();
    });
  });

  describe('atomicity with the business change', () => {
    it('no event is written when the business transaction is rolled back', async () => {
      await expect(
        asUserOf(a, () =>
          db.run(async (tx) => {
            await audit.record(tx, { action: 'atomic.rolled_back' });
            throw new Error('business failure');
          }),
        ),
      ).rejects.toThrow('business failure');

      expect(await eventsOf(a, 'atomic.rolled_back')).toEqual([]);
    });

    it('the business change is rolled back when the event cannot be written', async () => {
      const email = 'atomic@audit-alpha.example.test';

      await expect(
        asUserOf(a, () =>
          db.run(async (tx) => {
            await tx.user.create({ data: { id: uuidv7(), email, tenantId: a.tenantId } });
            await audit.record(tx, { action: 'not a valid action' });
          }),
        ),
      ).rejects.toBeInstanceOf(AuditEntryError);

      const users = await asUserOf(a, () => db.run((tx) => tx.user.findMany({ where: { email } })));
      expect(users).toEqual([]);
    });

    it('the business change is rolled back when the database refuses the event', async () => {
      const email = 'atomic-db@audit-alpha.example.test';

      // The actor does not exist: the composite foreign key refuses the event at INSERT.
      await expect(
        runInTenantContext({ tenantId: a.tenantId, userId: uuidv7() }, () =>
          db.run(async (tx) => {
            await tx.user.create({ data: { id: uuidv7(), email, tenantId: a.tenantId } });
            await audit.record(tx, { action: 'atomic.unknown_actor' });
          }),
        ),
      ).rejects.toBeDefined();

      const users = await asUserOf(a, () => db.run((tx) => tx.user.findMany({ where: { email } })));
      expect(users).toEqual([]);
      expect(await eventsOf(a, 'atomic.unknown_actor')).toEqual([]);
    });

    it('both are committed together on success', async () => {
      const email = 'committed@audit-alpha.example.test';
      const id = uuidv7();

      await asUserOf(a, () =>
        db.run(async (tx) => {
          await tx.user.create({ data: { id, email, tenantId: a.tenantId } });
          await audit.record(tx, { action: 'user.created', resource: { type: 'user', id } });
        }),
      );

      const users = await asUserOf(a, () => db.run((tx) => tx.user.findMany({ where: { email } })));
      expect(users).toHaveLength(1);
      expect(await eventsOf(a, 'user.created')).toHaveLength(1);
    });
  });

  describe('server time', () => {
    it('a time supplied in SQL is ignored', async () => {
      const id = uuidv7();
      await asTenant(runtime, a.tenantId, () =>
        runtime.query(
          `INSERT INTO audit_events (id, tenant_id, occurred_at, actor_type, action)
           VALUES ($1, $2, '2001-01-01T00:00:00Z', 'SYSTEM', 'time.forged')`,
          [id, a.tenantId],
        ),
      );

      const [event] = await eventsOf(a, 'time.forged');
      expect((event?.['occurred_at'] as Date).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('events of one transaction keep their order', async () => {
      await asUserOf(a, () =>
        db.run(async (tx) => {
          await audit.record(tx, { action: 'order.first' });
          await audit.record(tx, { action: 'order.second' });
        }),
      );
      const events = (await eventsOf(a)).filter((event) =>
        String(event['action']).startsWith('order.'),
      );
      expect(events.map((event) => event['action'])).toEqual(['order.first', 'order.second']);
      expect((events[1]?.['occurred_at'] as Date).getTime()).toBeGreaterThanOrEqual(
        (events[0]?.['occurred_at'] as Date).getTime(),
      );
    });
  });

  describe('tenant isolation', () => {
    it('an event of tenant A is invisible from the context of tenant B', async () => {
      await asUserOf(a, () =>
        db.run((tx) => audit.record(tx, { action: 'isolation.secret_of_a' })),
      );

      const fromB = await asUserOf(b, () => db.run((tx) => tx.auditEvent.findMany()));
      const fromA = await asUserOf(a, () =>
        db.run((tx) => tx.auditEvent.count({ where: { action: 'isolation.secret_of_a' } })),
      );

      expect(fromB.filter((event) => event.tenantId !== b.tenantId)).toEqual([]);
      expect(fromB.map((event) => event.action)).not.toContain('isolation.secret_of_a');
      expect(fromA).toBe(1);
    });

    it('direct SQL bound to B sees no event of A and cannot write one for A', async () => {
      const rows = await asTenant(runtime, b.tenantId, async () => {
        const result = await runtime.query(
          `SELECT 1 FROM audit_events WHERE action = 'isolation.secret_of_a'`,
        );
        return result.rowCount;
      });
      expect(rows).toBe(0);

      const state = await sqlState(() =>
        asTenant(runtime, b.tenantId, () =>
          runtime.query(
            `INSERT INTO audit_events (id, tenant_id, actor_type, action) VALUES ($1, $2, 'SYSTEM', 'isolation.forged')`,
            [uuidv7(), a.tenantId],
          ),
        ),
      );
      expect(state).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('an event cannot name a user of another tenant as its actor', async () => {
      const state = await sqlState(() =>
        asTenant(runtime, a.tenantId, () =>
          runtime.query(
            `INSERT INTO audit_events (id, tenant_id, actor_type, actor_user_id, action)
             VALUES ($1, $2, 'USER', $3, 'isolation.foreign_actor')`,
            [uuidv7(), a.tenantId, b.userIds[0]],
          ),
        ),
      );
      expect(state).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  describe('integrity rules enforced by the database', () => {
    const insert = (columns: string, values: string, params: unknown[] = []) =>
      sqlState(() =>
        asTenant(runtime, a.tenantId, () =>
          runtime.query(
            `INSERT INTO audit_events (id, tenant_id, ${columns}) VALUES ($1, $2, ${values})`,
            [uuidv7(), a.tenantId, ...params],
          ),
        ),
      );

    it('a transition needs both statuses', async () => {
      expect(
        await insert('actor_type, action, to_status', `'SYSTEM', 'db.half_transition', 'CLOSED'`),
      ).toBe(CHECK_VIOLATION);
    });

    it('a user event needs a user and a system event must not have one', async () => {
      expect(await insert('actor_type, action', `'USER', 'db.user_without_id'`)).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await insert('actor_type, actor_user_id, action', `'SYSTEM', $3, 'db.system_with_id'`, [
          a.userIds[0],
        ]),
      ).toBe(CHECK_VIOLATION);
    });

    it('the action key format is checked', async () => {
      expect(await insert('actor_type, action', `'SYSTEM', 'Not A Key'`)).toBe(CHECK_VIOLATION);
    });
  });
});
