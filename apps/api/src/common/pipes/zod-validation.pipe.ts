import { Injectable, type PipeTransform } from '@nestjs/common';
import { ERROR_CODES } from '@qhse/shared';
import type { z } from 'zod';
import { AppException } from '../errors/app.exception.js';

/** One entry of `details` in a VALIDATION_FAILED response. */
export interface FieldError {
  /** Dotted path of the offending field; empty string for the whole payload. */
  path: string;
  /** Stable zod issue code (e.g. `invalid_type`, `too_small`). */
  code: string;
  message: string;
}

/**
 * Validates and transforms an incoming value (body, query, params) with a zod schema.
 *
 * @example
 *   @Get()
 *   list(@Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery) {}
 */
@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: FieldError[] = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    }));
    throw new AppException(ERROR_CODES.VALIDATION_FAILED, 'Request validation failed', {
      details,
    });
  }
}
