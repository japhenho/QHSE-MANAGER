import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runInTenantContext } from '../tenancy/index.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { originOf } from './request-origin.js';

/**
 * Runs the handler of an authenticated request inside the tenant context of its
 * session. This is the link between "who is logged in" and "which tenant's data":
 * nothing sent by the client (body, query, header) can influence it.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) return next.handle(); // Public route: no tenant context.

    return new Observable((subscriber) => {
      const subscription = runInTenantContext(
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          request: originOf(request, auth.sessionId),
        },
        () => next.handle().subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }
}
