import { ERROR_CODES } from '@qhse/shared';
import request from 'supertest';
import { createTestApp, type TestApp } from './create-test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Health and HTTP foundation (e2e, real database)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ API_CORS_ORIGINS: ['http://localhost:5173'] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live answers 200 without touching the database', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready answers 200 when the database answers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('serves routes only under the /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(404);
    await request(app.getHttpServer()).get('/api/health/live').expect(404);
    await request(app.getHttpServer()).get('/api/v2/health/live').expect(404);
  });

  it('returns the NOT_FOUND envelope on an unknown route', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(response.body).sort()).toEqual(['code', 'message', 'requestId']);
    expect(response.body.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(typeof response.body.message).toBe('string');
    expect(response.body.requestId).toMatch(UUID);
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('reuses a well-formed incoming x-request-id and ignores a malformed one', async () => {
    const reused = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'trace-abc_123')
      .expect(404);
    expect(reused.body.requestId).toBe('trace-abc_123');
    expect(reused.headers['x-request-id']).toBe('trace-abc_123');

    const replaced = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'bad id with spaces')
      .expect(404);
    expect(replaced.body.requestId).toMatch(UUID);
  });

  it('returns the envelope for a malformed JSON body, without parser details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/does-not-exist')
      .set('content-type', 'application/json')
      .send('{"broken": ')
      .expect(400);

    expect(response.body).toEqual({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'Malformed request',
      requestId: expect.stringMatching(UUID),
    });
  });

  it('sets security headers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('allows CORS only for the configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes the OpenAPI document and Swagger UI outside production', async () => {
    const json = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(json.body.openapi).toMatch(/^3\./);
    expect(Object.keys(json.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/health/live', '/api/v1/health/ready']),
    );

    const ui = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(ui.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('Readiness when the database is down (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    // Port 1 on loopback: nothing listens there, the connection is refused at once.
    app = await createTestApp({
      DATABASE_URL: 'postgresql://nobody:unused@127.0.0.1:1/unreachable?schema=public',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('still starts and stays live', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready answers 503 through the error envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);

    expect(response.body).toEqual({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable',
      requestId: expect.stringMatching(UUID),
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('nobody');
    expect(serialized).not.toContain('ECONNREFUSED');
  });
});

describe('OpenAPI exposure when disabled (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ NODE_ENV: 'production', API_DOCS_ENABLED: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not serve the docs', async () => {
    const json = await request(app.getHttpServer()).get('/api/docs-json').expect(404);
    expect(json.body.code).toBe(ERROR_CODES.NOT_FOUND);

    await request(app.getHttpServer()).get('/api/docs').expect(404);
  });
});
