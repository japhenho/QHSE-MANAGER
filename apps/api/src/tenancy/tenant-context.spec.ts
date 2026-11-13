import {
  InvalidTenantContextError,
  MissingTenantContextError,
  requireTenantContext,
  runInTenantContext,
} from './tenant-context.js';
import { uuidv7 } from './uuid.js';

describe('tenant context', () => {
  it('throws outside of a context', () => {
    expect(() => requireTenantContext()).toThrow(MissingTenantContextError);
  });

  it('exposes the tenant and user inside the context, across awaits', async () => {
    const tenantId = uuidv7();
    const userId = uuidv7();

    const seen = await runInTenantContext({ tenantId, userId }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return requireTenantContext();
    });

    expect(seen).toEqual({ tenantId, userId });
  });

  it('does not leak after the context ends', async () => {
    await runInTenantContext({ tenantId: uuidv7() }, async () => undefined);
    expect(() => requireTenantContext()).toThrow(MissingTenantContextError);
  });

  it('keeps concurrent contexts apart', async () => {
    const tenants = [uuidv7(), uuidv7()];

    const seen = await Promise.all(
      tenants.map((tenantId, index) =>
        runInTenantContext({ tenantId }, async () => {
          await new Promise((resolve) => setTimeout(resolve, index === 0 ? 5 : 1));
          return requireTenantContext().tenantId;
        }),
      ),
    );

    expect(seen).toEqual(tenants);
  });

  it('cannot be modified from inside', () => {
    runInTenantContext({ tenantId: uuidv7() }, () => {
      const context = requireTenantContext() as { tenantId: string };
      expect(() => {
        context.tenantId = uuidv7();
      }).toThrow(TypeError);
    });
  });

  it.each(['', 'not-a-uuid', "'; DROP TABLE users; --"])('rejects tenant id %p', (tenantId) => {
    expect(() => runInTenantContext({ tenantId }, () => undefined)).toThrow(
      InvalidTenantContextError,
    );
  });

  it('rejects an invalid user id', () => {
    expect(() =>
      runInTenantContext({ tenantId: uuidv7(), userId: 'nope' }, () => undefined),
    ).toThrow(InvalidTenantContextError);
  });
});
