import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Clock } from '../common/clock.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RateLimiter } from './rate-limiter.service.js';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    Clock,
    AccessTokenService,
    AuthService,
    PasswordService,
    RateLimiter,
    // Deny by default: every route of the application goes through the guard.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [Clock, PasswordService, RateLimiter],
})
export class AuthModule {}
