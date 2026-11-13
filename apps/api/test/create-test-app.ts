import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ENV, type Env, loadEnv } from '../src/config/index.js';

export type TestApp = INestApplication<App>;

/**
 * Boots the real application (same module graph and HTTP setup as `main.ts`).
 * `envOverrides` replaces parts of the validated configuration for one scenario.
 */
export async function createTestApp(envOverrides: Partial<Env> = {}): Promise<TestApp> {
  const env: Env = { ...loadEnv(), LOG_LEVEL: 'silent', ...envOverrides };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile();

  const app = moduleRef.createNestApplication<TestApp>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return app;
}
