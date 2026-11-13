import { EnvValidationError, validateEnv } from './env.schema.js';

const DATABASE_URL = 'postgresql://app_user:not-a-real-secret@localhost:5432/app_db?schema=public';
const AUTH_JWT_SECRET = 'unit-test-signing-key-not-a-secret-0123456789';

function captureError(raw: Record<string, string | undefined>): EnvValidationError {
  try {
    validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('Expected validateEnv to throw');
}

describe('validateEnv', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(validateEnv({ DATABASE_URL, AUTH_JWT_SECRET })).toEqual({
      NODE_ENV: 'development',
      API_PORT: 3000,
      API_CORS_ORIGINS: [],
      API_DOCS_ENABLED: true,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      DATABASE_POOL_MAX: 10,
      API_TRUST_PROXY: 0,
      AUTH_JWT_SECRET,
      AUTH_JWT_SECRET_PREVIOUS: undefined,
      AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
      AUTH_SESSION_MAX_DAYS: 30,
      AUTH_REFRESH_IDLE_DAYS: 7,
      AUTH_REFRESH_GRACE_SECONDS: 10,
      AUTH_COOKIE_SECURE: false,
    });
  });

  it.each(['0', '201', 'many'])('rejects DATABASE_POOL_MAX=%s', (value) => {
    expect(() => validateEnv({ DATABASE_URL, AUTH_JWT_SECRET, DATABASE_POOL_MAX: value })).toThrow(
      /DATABASE_POOL_MAX/,
    );
  });

  it('parses and coerces a complete environment', () => {
    const env = validateEnv({
      AUTH_JWT_SECRET,
      NODE_ENV: 'production',
      API_PORT: '8080',
      API_CORS_ORIGINS: 'https://app.example.com, http://localhost:5173',
      API_DOCS_ENABLED: 'true',
      LOG_LEVEL: 'debug',
      DATABASE_URL,
    });

    expect(env.API_PORT).toBe(8080);
    expect(env.API_CORS_ORIGINS).toEqual(['https://app.example.com', 'http://localhost:5173']);
    expect(env.API_DOCS_ENABLED).toBe(true);
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('ignores unrelated variables', () => {
    expect(validateEnv({ DATABASE_URL, AUTH_JWT_SECRET, PATH: '/usr/bin' })).not.toHaveProperty(
      'PATH',
    );
  });

  it('treats empty optional variables as unset', () => {
    const env = validateEnv({
      AUTH_JWT_SECRET,
      DATABASE_URL,
      NODE_ENV: '',
      API_PORT: '',
      LOG_LEVEL: '',
      API_DOCS_ENABLED: '',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
  });

  describe('API docs flag', () => {
    it('is disabled by default in production', () => {
      expect(
        validateEnv({ DATABASE_URL, AUTH_JWT_SECRET, NODE_ENV: 'production' }).API_DOCS_ENABLED,
      ).toBe(false);
    });

    it('can be enabled explicitly in production', () => {
      const env = validateEnv({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        NODE_ENV: 'production',
        API_DOCS_ENABLED: 'true',
      });
      expect(env.API_DOCS_ENABLED).toBe(true);
    });

    it('can be disabled explicitly outside production', () => {
      const env = validateEnv({
        DATABASE_URL,
        AUTH_JWT_SECRET,
        NODE_ENV: 'development',
        API_DOCS_ENABLED: 'false',
      });
      expect(env.API_DOCS_ENABLED).toBe(false);
    });

    it('rejects anything but "true" or "false"', () => {
      expect(
        captureError({ DATABASE_URL, AUTH_JWT_SECRET, API_DOCS_ENABLED: 'yes' }).problems,
      ).toEqual(['API_DOCS_ENABLED: must be one of: true, false']);
    });
  });

  it('is silent by default under test', () => {
    expect(validateEnv({ DATABASE_URL, AUTH_JWT_SECRET, NODE_ENV: 'test' }).LOG_LEVEL).toBe(
      'silent',
    );
  });

  it('fails when DATABASE_URL is missing', () => {
    const error = captureError({ AUTH_JWT_SECRET });
    expect(error.problems).toEqual(['DATABASE_URL: is required']);
    expect(error.message).toContain('Invalid environment configuration:');
  });

  it('fails when DATABASE_URL is empty or not a PostgreSQL URL', () => {
    const expected = ['DATABASE_URL: must be a valid postgresql:// connection URL'];
    expect(captureError({ AUTH_JWT_SECRET, DATABASE_URL: '' }).problems).toEqual(expected);
    expect(
      captureError({ AUTH_JWT_SECRET, DATABASE_URL: 'mysql://u:p@localhost/db' }).problems,
    ).toEqual(expected);
  });

  it.each(['0', '65536', '80.5', 'abc'])('rejects API_PORT=%s', (port) => {
    const error = captureError({ DATABASE_URL, AUTH_JWT_SECRET, API_PORT: port });
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toMatch(/^API_PORT: /);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(captureError({ DATABASE_URL, AUTH_JWT_SECRET, NODE_ENV: 'staging' }).problems).toEqual([
      'NODE_ENV: must be one of: development, test, production',
    ]);
  });

  it.each(['*', 'app.example.com', 'https://app.example.com/path', 'ftp://example.com'])(
    'rejects API_CORS_ORIGINS=%s',
    (origins) => {
      const error = captureError({ DATABASE_URL, AUTH_JWT_SECRET, API_CORS_ORIGINS: origins });
      expect(error.problems).toHaveLength(1);
      expect(error.problems[0]).toMatch(/^API_CORS_ORIGINS: must be a comma-separated list/);
    },
  );

  it('requires a signing key of at least 32 characters', () => {
    expect(captureError({ DATABASE_URL }).problems).toEqual(['AUTH_JWT_SECRET: is required']);
    expect(captureError({ DATABASE_URL, AUTH_JWT_SECRET: 'too-short' }).problems).toEqual([
      'AUTH_JWT_SECRET: must be at least 32',
    ]);
  });

  it('uses a Secure cookie by default in production only', () => {
    const base = { DATABASE_URL, AUTH_JWT_SECRET };
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).AUTH_COOKIE_SECURE).toBe(true);
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).AUTH_COOKIE_SECURE).toBe(false);
    expect(
      validateEnv({ ...base, NODE_ENV: 'development', AUTH_COOKIE_SECURE: 'true' })
        .AUTH_COOKIE_SECURE,
    ).toBe(true);
  });

  it('reports every invalid variable at once', () => {
    const error = captureError({ NODE_ENV: 'staging', API_PORT: '-1' });
    expect(error.problems.map((problem) => problem.split(':')[0])).toEqual([
      'NODE_ENV',
      'API_PORT',
      'DATABASE_URL',
      'AUTH_JWT_SECRET',
    ]);
  });

  it('never echoes received values, which may be secrets', () => {
    const secret = 'sup3r-s3cret-value';
    const error = captureError({
      NODE_ENV: secret,
      API_PORT: secret,
      API_CORS_ORIGINS: secret,
      API_DOCS_ENABLED: secret,
      LOG_LEVEL: secret,
      DATABASE_URL: `mysql://user:${secret}@localhost/db`,
      AUTH_JWT_SECRET: secret,
    });

    expect(error.problems).toHaveLength(7);
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error.problems)).not.toContain(secret);
  });
});
