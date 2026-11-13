import { scopeArgs, TENANT_SCOPE, TenantScopeError } from './tenant-scope.js';

const TENANT_A = '01930000-0000-7000-8000-00000000000a';
const TENANT_B = '01930000-0000-7000-8000-00000000000b';

describe('scopeArgs (barrier 1)', () => {
  describe('reads', () => {
    it.each(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])(
      '%s without arguments is restricted to the tenant',
      (operation) => {
        expect(scopeArgs('User', operation, undefined, TENANT_A)).toEqual({
          where: { AND: [{ tenantId: TENANT_A }] },
        });
      },
    );

    it('keeps the caller filter and adds the tenant with AND', () => {
      const scoped = scopeArgs(
        'User',
        'findMany',
        { where: { status: 'ACTIVE' }, take: 10 },
        TENANT_A,
      );
      expect(scoped).toEqual({
        where: { status: 'ACTIVE', AND: [{ tenantId: TENANT_A }] },
        take: 10,
      });
    });

    it('a caller asking for another tenant gets a contradiction, not the other tenant', () => {
      const scoped = scopeArgs('User', 'findMany', { where: { tenantId: TENANT_B } }, TENANT_A);
      expect(scoped['where']).toEqual({ tenantId: TENANT_B, AND: [{ tenantId: TENANT_A }] });
    });

    it('cannot be widened with OR', () => {
      const where = { OR: [{ tenantId: TENANT_B }, { email: 'x@example.test' }] };
      const scoped = scopeArgs('User', 'findMany', { where }, TENANT_A);
      expect(scoped['where']).toEqual({ ...where, AND: [{ tenantId: TENANT_A }] });
    });

    it('preserves an existing AND (array or single object)', () => {
      expect(
        scopeArgs('User', 'findMany', { where: { AND: [{ status: 'ACTIVE' }] } }, TENANT_A)[
          'where'
        ],
      ).toEqual({ AND: [{ status: 'ACTIVE' }, { tenantId: TENANT_A }] });
      expect(
        scopeArgs('User', 'findMany', { where: { AND: { status: 'ACTIVE' } } }, TENANT_A)['where'],
      ).toEqual({ AND: [{ status: 'ACTIVE' }, { tenantId: TENANT_A }] });
    });

    it('findUnique keeps the unique key and adds the tenant', () => {
      const scoped = scopeArgs('User', 'findUnique', { where: { id: 'u1' } }, TENANT_A);
      expect(scoped['where']).toEqual({ id: 'u1', AND: [{ tenantId: TENANT_A }] });
    });

    it('the tenant registry is filtered on its own id', () => {
      const scoped = scopeArgs('Tenant', 'findUnique', { where: { id: TENANT_B } }, TENANT_A);
      expect(scoped['where']).toEqual({ id: TENANT_B, AND: [{ id: TENANT_A }] });
    });

    it('does not mutate the caller arguments', () => {
      const args = { where: { status: 'ACTIVE' } };
      scopeArgs('User', 'findMany', args, TENANT_A);
      expect(args).toEqual({ where: { status: 'ACTIVE' } });
    });
  });

  describe('creates', () => {
    it('forces the tenant, replacing the one supplied by the caller', () => {
      const scoped = scopeArgs(
        'User',
        'create',
        { data: { id: 'u1', email: 'a@example.test', tenantId: TENANT_B } },
        TENANT_A,
      );
      expect(scoped['data']).toEqual({ id: 'u1', email: 'a@example.test', tenantId: TENANT_A });
    });

    it('drops a relation that would attach the row to another tenant', () => {
      const scoped = scopeArgs(
        'User',
        'create',
        { data: { id: 'u1', email: 'a@example.test', tenant: { connect: { id: TENANT_B } } } },
        TENANT_A,
      );
      expect(scoped['data']).toEqual({ id: 'u1', email: 'a@example.test', tenantId: TENANT_A });
    });

    it.each(['createMany', 'createManyAndReturn'])(
      '%s forces the tenant on every row',
      (operation) => {
        const scoped = scopeArgs(
          'User',
          operation,
          { data: [{ id: 'u1', tenantId: TENANT_B }, { id: 'u2' }] },
          TENANT_A,
        );
        expect(scoped['data']).toEqual([
          { id: 'u1', tenantId: TENANT_A },
          { id: 'u2', tenantId: TENANT_A },
        ]);
      },
    );

    it('refuses a create without data', () => {
      expect(() => scopeArgs('User', 'create', {}, TENANT_A)).toThrow(TenantScopeError);
    });
  });

  describe('updates and deletes', () => {
    it.each(['update', 'updateMany', 'updateManyAndReturn'])(
      '%s is filtered and cannot move a row to another tenant',
      (operation) => {
        const scoped = scopeArgs(
          'User',
          operation,
          {
            where: { id: 'u1' },
            data: { status: 'DISABLED', tenantId: TENANT_B, tenant: { connect: { id: TENANT_B } } },
          },
          TENANT_A,
        );
        expect(scoped).toEqual({
          where: { id: 'u1', AND: [{ tenantId: TENANT_A }] },
          data: { status: 'DISABLED' },
        });
      },
    );

    it.each(['delete', 'deleteMany'])('%s is filtered', (operation) => {
      expect(scopeArgs('User', operation, { where: { id: 'u1' } }, TENANT_A)).toEqual({
        where: { id: 'u1', AND: [{ tenantId: TENANT_A }] },
      });
    });

    it('deleteMany without filter only targets the tenant', () => {
      expect(scopeArgs('User', 'deleteMany', undefined, TENANT_A)).toEqual({
        where: { AND: [{ tenantId: TENANT_A }] },
      });
    });

    it('upsert scopes the lookup, the created row and the update', () => {
      const scoped = scopeArgs(
        'User',
        'upsert',
        {
          where: { id: 'u1' },
          create: { id: 'u1', email: 'a@example.test', tenantId: TENANT_B },
          update: { email: 'b@example.test', tenantId: TENANT_B },
        },
        TENANT_A,
      );
      expect(scoped).toEqual({
        where: { id: 'u1', AND: [{ tenantId: TENANT_A }] },
        create: { id: 'u1', email: 'a@example.test', tenantId: TENANT_A },
        update: { email: 'b@example.test' },
      });
    });
  });

  describe('refusals', () => {
    it.each(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'])(
      'the tenant registry cannot be written (%s)',
      (operation) => {
        expect(() => scopeArgs('Tenant', operation, { where: {}, data: {} }, TENANT_A)).toThrow(
          TenantScopeError,
        );
      },
    );

    it('refuses an operation it does not know', () => {
      expect(() => scopeArgs('User', 'someFutureOperation', {}, TENANT_A)).toThrow(
        TenantScopeError,
      );
    });
  });

  describe('append-only models', () => {
    it('can be created and read within the tenant', () => {
      expect(
        scopeArgs('AuditEvent', 'create', { data: { id: 'e1', tenantId: TENANT_B } }, TENANT_A),
      ).toEqual({
        data: { id: 'e1', tenantId: TENANT_A },
      });
      expect(scopeArgs('AuditEvent', 'findMany', {}, TENANT_A)).toEqual({
        where: { AND: [{ tenantId: TENANT_A }] },
      });
    });

    it.each(['update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert'])(
      'cannot be changed nor deleted (%s)',
      (operation) => {
        expect(() =>
          scopeArgs('AuditEvent', operation, { where: { id: 'e1' }, data: {} }, TENANT_A),
        ).toThrow(/append-only/);
      },
    );
  });

  it('declares a rule for every model', () => {
    expect(Object.keys(TENANT_SCOPE).sort()).toEqual([
      'AuditEvent',
      'AuthSession',
      'LoginThrottle',
      'RefreshToken',
      'Role',
      'RoleAssignment',
      'RolePermission',
      'Tenant',
      'User',
    ]);
  });
});
