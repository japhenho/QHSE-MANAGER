import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { ERROR_CODES } from '@qhse/shared';

/** OpenAPI description of the shared `ApiError` envelope. */
export const API_ERROR_SCHEMA: NonNullable<ApiResponseSchemaHost['schema']> = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', enum: Object.values(ERROR_CODES) },
    message: { type: 'string' },
    details: { description: 'Optional, code-specific details (e.g. field errors)' },
    requestId: { type: 'string', description: 'Correlation id, also sent as x-request-id' },
  },
};
