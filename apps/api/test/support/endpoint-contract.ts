import request from 'supertest';
import type { TestApp } from '../create-test-app.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface EndpointCase {
  method: Method;
  /** Full path, e.g. `/api/v1/roles/<id>`. */
  url: string;
  body?: Record<string, unknown>;
}

function call(app: TestApp, endpoint: EndpointCase, accessToken?: string) {
  let req = request(app.getHttpServer())[endpoint.method](endpoint.url);
  if (accessToken) req = req.set('Authorization', `Bearer ${accessToken}`);
  return endpoint.body ? req.send(endpoint.body) : req;
}

/**
 * Criterion CC-2 for one endpoint:
 *  - without a token: 401 UNAUTHENTICATED;
 *  - with a valid session that lacks the permission: 403 FORBIDDEN.
 * `tokenWithoutPermission` must belong to a user of the SAME tenant as the resource, so
 * that the refusal can only come from the missing permission.
 */
export async function expectPermissionRequired(
  app: TestApp,
  endpoint: EndpointCase,
  tokenWithoutPermission: string,
): Promise<void> {
  const anonymous = await call(app, endpoint);
  expect([endpoint.url, 'anonymous', anonymous.status]).toEqual([endpoint.url, 'anonymous', 401]);
  expect(anonymous.body).toMatchObject({ code: 'UNAUTHENTICATED' });

  const refused = await call(app, endpoint, tokenWithoutPermission);
  expect([endpoint.url, 'no permission', refused.status]).toEqual([
    endpoint.url,
    'no permission',
    403,
  ]);
  expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
}

/**
 * Criterion CC-1 for an endpoint addressing ONE resource: a user of another tenant who
 * holds the permission gets exactly the answer given for an identifier that does not
 * exist (404 NOT_FOUND, same body apart from the request id).
 * `unknownUrl` is the same endpoint with a random, non-existent identifier.
 */
export async function expectInvisibleAcrossTenants(
  app: TestApp,
  endpoint: EndpointCase,
  unknownUrl: string,
  tokenOfOtherTenant: string,
): Promise<void> {
  const foreign = await call(app, endpoint, tokenOfOtherTenant);
  const missing = await call(app, { ...endpoint, url: unknownUrl }, tokenOfOtherTenant);

  expect([endpoint.url, foreign.status]).toEqual([endpoint.url, 404]);
  expect(missing.status).toBe(404);
  const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
  expect(strip(foreign.body)).toEqual(strip(missing.body));
  expect(foreign.body).toMatchObject({ code: 'NOT_FOUND' });
}

/**
 * Criterion CC-1 for a LIST endpoint: called by a user of another tenant, it contains
 * none of the given identifiers and its total does not count them.
 */
export async function expectListExcludes(
  app: TestApp,
  url: string,
  tokenOfOtherTenant: string,
  foreignIds: readonly string[],
): Promise<{ items: { id: string }[]; total: number }> {
  const response = await call(app, { method: 'get', url }, tokenOfOtherTenant);
  expect([url, response.status]).toEqual([url, 200]);
  const serialized = JSON.stringify(response.body);
  for (const id of foreignIds) expect([url, serialized.includes(id)]).toEqual([url, false]);
  expect(response.body.total).toBe(response.body.items.length);
  return response.body;
}

/**
 * Scope test for an endpoint addressing ONE resource located in the organisation:
 * a user of the SAME tenant who holds the permission, but on another scope, gets
 * exactly the answer given for an identifier that does not exist (404 NOT_FOUND).
 * `unknownUrl` is the same endpoint with a random, non-existent identifier.
 */
export const expectInvisibleOutsideScope = expectInvisibleAcrossTenants;

/**
 * Scope test for a LIST endpoint: called by a user whose scope does not cover them, the
 * list contains none of the given identifiers and its total does not count them, while
 * it still contains `visibleIds` (the scope is a filter, not a refusal).
 */
export async function expectListLimitedToScope(
  app: TestApp,
  url: string,
  scopedToken: string,
  expected: { visibleIds: readonly string[]; hiddenIds: readonly string[] },
): Promise<void> {
  const body = await expectListExcludes(app, url, scopedToken, expected.hiddenIds);
  expect([url, body.items.map((item) => item.id).sort()]).toEqual([
    url,
    [...expected.visibleIds].sort(),
  ]);
}
