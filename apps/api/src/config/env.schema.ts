import { z } from 'zod';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Accepts only the literal strings "true" / "false" so a typo never silently means false. */
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Treats an empty variable (`FOO=`) the same as an unset one. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'postgresql:' || url.protocol === 'postgres:';
  } catch {
    return false;
  }
}

/**
 * Comma-separated list of exact browser origins (scheme + host + optional port).
 * Wildcards are rejected on purpose: CORS must stay an explicit allow-list.
 */
const corsOrigins = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .refine((origins) => origins.every(isHttpOrigin), {
    message:
      'must be a comma-separated list of http(s) origins without path or wildcard (e.g. https://app.example.com)',
  });

export const envSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(NODE_ENVIRONMENTS).default('development')),
  API_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(3000)),
  API_CORS_ORIGINS: corsOrigins,
  /** Swagger UI / OpenAPI JSON. Unset means: enabled, except when NODE_ENV=production. */
  API_DOCS_ENABLED: z.preprocess(emptyToUndefined, booleanFlag.optional()),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(LOG_LEVELS).optional()),
  DATABASE_URL: z
    .string({ error: 'is required' })
    .refine(isPostgresUrl, { message: 'must be a valid postgresql:// connection URL' }),
  /** Number of reverse proxies in front of the API (0 = none). Needed for the client IP. */
  API_TRUST_PROXY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(5).default(0)),
  /** Signing key of access tokens. A secret: at least 32 characters, never committed. */
  AUTH_JWT_SECRET: z.string({ error: 'is required' }).min(32, 'must be at least 32 characters'),
  /** Previous signing key, still accepted for verification during a key rotation. */
  AUTH_JWT_SECRET_PREVIOUS: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'must be at least 32 characters').optional(),
  ),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(60).max(3600).default(900),
  ),
  /** Absolute lifetime of a session, whatever the activity. */
  AUTH_SESSION_MAX_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(365).default(30),
  ),
  /** A session ends after this many days without refresh. */
  AUTH_REFRESH_IDLE_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(365).default(7),
  ),
  /** Seconds during which replaying the previous refresh token is tolerated (0 disables). */
  AUTH_REFRESH_GRACE_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(60).default(10),
  ),
  /** `Secure` attribute of the refresh cookie. Unset: true when NODE_ENV=production. */
  AUTH_COOKIE_SECURE: z.preprocess(emptyToUndefined, booleanFlag.optional()),
  /** Maximum connections of the API pool. Every tenant transaction holds one while it runs. */
  DATABASE_POOL_MAX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(200).default(10),
  ),
});

type ParsedEnv = z.infer<typeof envSchema>;

/** Validated, typed application configuration. */
export interface Env {
  readonly NODE_ENV: ParsedEnv['NODE_ENV'];
  readonly API_PORT: number;
  readonly API_CORS_ORIGINS: readonly string[];
  readonly API_DOCS_ENABLED: boolean;
  readonly LOG_LEVEL: (typeof LOG_LEVELS)[number];
  readonly DATABASE_URL: string;
  readonly DATABASE_POOL_MAX: number;
  readonly API_TRUST_PROXY: number;
  readonly AUTH_JWT_SECRET: string;
  readonly AUTH_JWT_SECRET_PREVIOUS: string | undefined;
  readonly AUTH_ACCESS_TOKEN_TTL_SECONDS: number;
  readonly AUTH_SESSION_MAX_DAYS: number;
  readonly AUTH_REFRESH_IDLE_DAYS: number;
  readonly AUTH_REFRESH_GRACE_SECONDS: number;
  readonly AUTH_COOKIE_SECURE: boolean;
}

export class EnvValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      ['Invalid environment configuration:', ...problems.map((problem) => `  - ${problem}`)].join(
        '\n',
      ),
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates raw environment variables and applies defaults.
 *
 * The error only ever names the offending variables and the rule they break:
 * received values are never included, because they may be secrets.
 */
export function validateEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.length > 0 ? issue.path.join('.') : '(environment)';
      return `${name}: ${describeIssue(issue)}`;
    });
    throw new EnvValidationError(problems);
  }

  const parsed = result.data;
  return Object.freeze({
    NODE_ENV: parsed.NODE_ENV,
    API_PORT: parsed.API_PORT,
    API_CORS_ORIGINS: Object.freeze([...parsed.API_CORS_ORIGINS]),
    API_DOCS_ENABLED: parsed.API_DOCS_ENABLED ?? parsed.NODE_ENV !== 'production',
    LOG_LEVEL: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    DATABASE_URL: parsed.DATABASE_URL,
    DATABASE_POOL_MAX: parsed.DATABASE_POOL_MAX,
    API_TRUST_PROXY: parsed.API_TRUST_PROXY,
    AUTH_JWT_SECRET: parsed.AUTH_JWT_SECRET,
    AUTH_JWT_SECRET_PREVIOUS: parsed.AUTH_JWT_SECRET_PREVIOUS,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: parsed.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    AUTH_SESSION_MAX_DAYS: parsed.AUTH_SESSION_MAX_DAYS,
    AUTH_REFRESH_IDLE_DAYS: parsed.AUTH_REFRESH_IDLE_DAYS,
    AUTH_REFRESH_GRACE_SECONDS: parsed.AUTH_REFRESH_GRACE_SECONDS,
    AUTH_COOKIE_SECURE: parsed.AUTH_COOKIE_SECURE ?? parsed.NODE_ENV === 'production',
  });
}

/** Maps a zod issue to a message that is guaranteed not to echo the received value. */
function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'custom':
      return issue.message;
    case 'invalid_value':
      return `must be one of: ${issue.values.map(String).join(', ')}`;
    case 'invalid_type':
      return issue.message === 'is required' ? issue.message : `must be a valid ${issue.expected}`;
    case 'too_small':
      return `must be at least ${String(issue.minimum)}`;
    case 'too_big':
      return `must be at most ${String(issue.maximum)}`;
    default:
      return 'is invalid';
  }
}
