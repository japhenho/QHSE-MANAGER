import { AccessScope, Grants } from './access-scope.js';

const C1 = 'company-1';
const C2 = 'company-2';
const S1 = { id: 'site-1', companyId: C1 };
const S2 = { id: 'site-2', companyId: C1 };
const S3 = { id: 'site-3', companyId: C2 };
const D1 = { id: 'dept-1', siteId: S1.id, companyId: C1 };
const D2 = { id: 'dept-2', siteId: S2.id, companyId: C1 };
const D3 = { id: 'dept-3', siteId: S3.id, companyId: C2 };

describe('AccessScope', () => {
  it('nothing: covers nothing and its filters match nothing', () => {
    const scope = AccessScope.NONE;
    expect(scope.isEmpty).toBe(true);
    expect([scope.coversCompany(C1), scope.coversSite(S1), scope.coversDepartment(D1)]).toEqual([
      false,
      false,
      false,
    ]);
    expect(scope.companyFilter()).toEqual({ id: { in: [] } });
    expect(scope.siteFilter()).toEqual({ OR: [{ companyId: { in: [] } }, { id: { in: [] } }] });
  });

  it('tenant: covers everything, without any filter', () => {
    const scope = AccessScope.TENANT;
    expect(scope.isEmpty).toBe(false);
    expect([scope.coversCompany(C2), scope.coversSite(S3), scope.coversDepartment(D3)]).toEqual([
      true,
      true,
      true,
    ]);
    expect([scope.companyFilter(), scope.siteFilter(), scope.departmentFilter()]).toEqual([
      {},
      {},
      {},
    ]);
  });

  it('company: covers its sites and their departments, not another company', () => {
    const scope = new AccessScope(false, [C1], [], []);
    expect([scope.coversCompany(C1), scope.coversSite(S1), scope.coversSite(S2)]).toEqual([
      true,
      true,
      true,
    ]);
    expect([scope.coversDepartment(D1), scope.coversDepartment(D2)]).toEqual([true, true]);
    expect([scope.coversCompany(C2), scope.coversSite(S3), scope.coversDepartment(D3)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('site: covers the site and its departments, neither its company nor a sibling site', () => {
    const scope = new AccessScope(false, [], [S1.id], []);
    expect([scope.coversSite(S1), scope.coversDepartment(D1)]).toEqual([true, true]);
    expect([scope.coversCompany(C1), scope.coversSite(S2), scope.coversDepartment(D2)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('department: covers that department only', () => {
    const scope = new AccessScope(false, [], [], [D1.id]);
    expect(scope.coversDepartment(D1)).toBe(true);
    expect([scope.coversSite(S1), scope.coversCompany(C1), scope.coversDepartment(D2)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('several scopes add up (union), they do not intersect', () => {
    const scope = new AccessScope(false, [], [S1.id, S3.id], [D2.id]);
    expect([
      scope.coversDepartment(D1),
      scope.coversDepartment(D3),
      scope.coversDepartment(D2),
    ]).toEqual([true, true, true]);
    expect(scope.coversSite(S2)).toBe(false);
    expect(scope.departmentFilter()).toEqual({
      OR: [
        { site: { companyId: { in: [] } } },
        { siteId: { in: [S1.id, S3.id] } },
        { id: { in: [D2.id] } },
      ],
    });
  });
});

describe('Grants', () => {
  const grants = new Grants(
    new Map([
      ['role:read', AccessScope.TENANT],
      ['organization:read', new AccessScope(false, [], [S1.id], [])],
      ['user:read', AccessScope.NONE],
    ]),
  );

  it('separates what is held for the whole tenant from what is held somewhere', () => {
    expect([...grants.tenantWide()]).toEqual(['role:read']);
    expect([...grants.anywhere()].sort()).toEqual(['organization:read', 'role:read']);
  });

  it('a permission never granted has an empty scope', () => {
    expect(grants.scopeOf('audit-log:read').isEmpty).toBe(true);
    expect(grants.scopeOf('organization:read').coversSite(S1)).toBe(true);
  });
});
