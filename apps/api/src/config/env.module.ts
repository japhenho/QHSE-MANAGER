import { Global, Module } from '@nestjs/common';
import { loadEnv } from './load-env.js';

/** Injection token for the validated {@link Env} object. */
export const ENV = Symbol('ENV');

/**
 * Exposes the validated configuration to the whole application.
 * The factory runs at bootstrap, so an invalid environment stops the startup.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadEnv }],
  exports: [ENV],
})
export class EnvModule {}
