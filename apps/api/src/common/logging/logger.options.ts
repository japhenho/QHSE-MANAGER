import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';
import type { Env } from '../../config/index.js';
import { resolveRequestId } from './request-id.js';

/** Paths whose values must never reach the logs. */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

const HEALTH_PATH = /\/health\/(live|ready)$/;

/** Structured JSON logging (one line per event) with a request id on every request log. */
/** Anything pino can write a log line to. */
export interface LogStream {
  write(line: string): void;
}

export function buildLoggerOptions(env: Env, stream?: LogStream): Params {
  const options: Options = {
    level: env.LOG_LEVEL,
    genReqId: resolveRequestId,
    redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      // Probes are called every few seconds; successful ones are noise.
      ignore: (req) => HEALTH_PATH.test((req.url ?? '').split('?')[0] ?? ''),
    },
  };
  return { pinoHttp: stream ? [options, stream] : options };
}
