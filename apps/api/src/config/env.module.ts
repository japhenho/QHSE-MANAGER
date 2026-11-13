import { Global, Module } from '@nestjs/common';
import { loadEnv } from './load-env.js';

/** Injection token for the validated {@link Env} object. */
export const ENV = Symbol('ENV');

/**
 * Optional destination of the structured logs (a writable stream). Undefined in normal
 * operation: logs go to standard output. Tests override it to inspect what is logged.
 */
export const LOG_STREAM = Symbol('LOG_STREAM');

/**
 * Exposes the validated configuration to the whole application.
 * The factory runs at bootstrap, so an invalid environment stops the startup.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: loadEnv },
    { provide: LOG_STREAM, useValue: undefined },
  ],
  exports: [ENV, LOG_STREAM],
})
export class EnvModule {}
