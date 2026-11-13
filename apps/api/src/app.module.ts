import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { buildLoggerOptions } from './common/logging/logger.options.js';
import { ENV, EnvModule, LOG_STREAM } from './config/index.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({ inject: [ENV, LOG_STREAM], useFactory: buildLoggerOptions }),
    PrismaModule,
    TenancyModule,
    AuditModule,
    AuthModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
