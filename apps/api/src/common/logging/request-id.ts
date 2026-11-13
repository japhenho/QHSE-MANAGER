import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Only short, log-safe identifiers coming from a client or a proxy are reused. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

type IdentifiedRequest = IncomingMessage & { id?: unknown };

/**
 * Returns the request id for a request: the one already assigned if any, else the
 * incoming `x-request-id` header when it is well-formed, else a fresh UUID.
 * The id is stored on the request and echoed in the response header.
 */
export function resolveRequestId(req: IdentifiedRequest, res: ServerResponse): string {
  const existing = getRequestId(req);
  if (existing !== undefined) return existing;

  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Express middleware assigning the request id. It must be registered first so that
 * errors raised by earlier layers than the HTTP logger (body parser) carry an id too.
 */
export function requestIdMiddleware(
  req: IdentifiedRequest,
  res: ServerResponse,
  next: () => void,
): void {
  resolveRequestId(req, res);
  next();
}

/** Reads the id previously assigned by the HTTP logger, if any. */
export function getRequestId(req: { id?: unknown }): string | undefined {
  const { id } = req;
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return String(id);
  return undefined;
}
