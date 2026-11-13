import { type INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './common/logging/request-id.js';
import { ENV, type Env } from './config/index.js';

export const GLOBAL_PREFIX = 'api';
export const DEFAULT_API_VERSION = '1';
export const DOCS_PATH = `${GLOBAL_PREFIX}/docs`;
export const DOCS_JSON_PATH = `${GLOBAL_PREFIX}/docs-json`;

/**
 * Applies everything that shapes the HTTP surface (logger, security headers, CORS,
 * routing, OpenAPI). Shared by `main.ts` and the e2e tests so both run the same app.
 */
export function configureApp(app: INestApplication): Env {
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  // Client IP behind reverse proxies (rate limiting, audit). 0 = trust no proxy header.
  (app as NestExpressApplication).set('trust proxy', env.API_TRUST_PROXY);
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.enableCors({
    // Exact allow-list; an empty list means no cross-origin browser access at all.
    origin: [...env.API_CORS_ORIGINS],
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  // Routes live under /api/v1/...
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });
  app.enableShutdownHooks();

  if (env.API_DOCS_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('QHSE Manager API')
      .setDescription('REST API of the QHSE Manager platform.')
      .setVersion(DEFAULT_API_VERSION)
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(DOCS_PATH, app, document, {
      jsonDocumentUrl: DOCS_JSON_PATH,
      raw: ['json'],
    });
  }

  return env;
}
