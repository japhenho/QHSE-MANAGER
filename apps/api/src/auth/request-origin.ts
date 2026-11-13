import type { Request } from 'express';
import { getRequestId } from '../common/logging/request-id.js';
import type { RequestOrigin } from '../tenancy/index.js';

/** What the audit log keeps about where a request came from. */
export function originOf(request: Request, sessionId?: string): RequestOrigin {
  const userAgent = request.headers['user-agent'];
  const requestId = getRequestId(request);
  return {
    ...(requestId === undefined ? {} : { requestId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(request.ip === undefined ? {} : { ipAddress: request.ip }),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}
