import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Clock } from '../src/common/clock.js';
import type { LogStream } from '../src/common/logging/logger.options.js';
import { ENV, type Env, loadEnv, LOG_STREAM } from '../src/config/index.js';

export type TestApp = INestApplication<App>;

/**
 * Boots the real application (same module graph and HTTP setup as `main.ts`).
 * `envOverrides` replaces parts of the validated configuration for one scenario.
 */
export interface TestAppOptions {
  /** Replaces the system clock (token expiry, lockouts). */
  clock?: Clock;
  /** Receives every structured log line. */
  logStream?: LogStream;
}

export async function createTestApp(
  envOverrides: Partial<Env> = {},
  options: TestAppOptions = {},
): Promise<TestApp> {
  const env: Env = { ...loadEnv(), LOG_LEVEL: 'silent', ...envOverrides };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env);
  if (options.clock) builder = builder.overrideProvider(Clock).useValue(options.clock);
  if (options.logStream) {
    builder = builder.overrideProvider(LOG_STREAM).useValue(options.logStream);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<TestApp>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return app;
}
