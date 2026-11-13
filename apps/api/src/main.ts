import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { EnvValidationError, loadEnv } from './config/index.js';

async function bootstrap(): Promise<void> {
  // Validate the configuration before anything else so a bad environment fails
  // fast with a readable message instead of a framework stack trace.
  loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = configureApp(app);

  await app.listen(env.API_PORT);
  app.get(Logger).log(`API listening on port ${env.API_PORT} (${env.NODE_ENV})`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(
      `Fatal startup error: ${error instanceof Error ? error.message : 'unknown'}\n`,
    );
  }
  process.exit(1);
});
