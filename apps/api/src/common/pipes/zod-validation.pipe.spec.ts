import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, MAX_PAGE_SIZE, paginationQuerySchema } from '@qhse/shared';
import { z } from 'zod';
import { AppException } from '../errors/app.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

function captureException(run: () => unknown): AppException {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('Expected the pipe to throw');
}

describe('ZodValidationPipe', () => {
  const schema = z.object({
    title: z.string().min(3),
    site: z.object({ code: z.string() }),
    tags: z.array(z.string()).default([]),
  });

  it('returns the parsed value, with defaults and unknown keys stripped', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ title: 'Audit', site: { code: 'PNR' }, extra: true })).toEqual({
      title: 'Audit',
      site: { code: 'PNR' },
      tags: [],
    });
  });

  it('coerces query strings with the shared pagination schema', () => {
    const pipe = new ZodValidationPipe(paginationQuerySchema);

    expect(pipe.transform({ page: '2', pageSize: '10' })).toEqual({ page: 2, pageSize: 10 });
    expect(pipe.transform({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('throws VALIDATION_FAILED (400) with one detail per invalid field', () => {
    const pipe = new ZodValidationPipe(schema);

    const error = captureException(() => pipe.transform({ title: 'A', site: { code: 42 } }));

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.message).toBe('Request validation failed');
    expect(error.details).toEqual([
      { path: 'title', code: 'too_small', message: expect.any(String) },
      { path: 'site.code', code: 'invalid_type', message: expect.any(String) },
    ]);
  });

  it('enforces the server-side page size limit', () => {
    const pipe = new ZodValidationPipe(paginationQuerySchema);

    const error = captureException(() => pipe.transform({ pageSize: String(MAX_PAGE_SIZE + 1) }));

    expect(error.details).toEqual([
      { path: 'pageSize', code: 'too_big', message: expect.any(String) },
    ]);
  });

  it('uses an empty path when the payload itself is invalid', () => {
    const pipe = new ZodValidationPipe(schema);

    const error = captureException(() => pipe.transform(undefined));

    expect(error.details).toEqual([
      { path: '', code: 'invalid_type', message: expect.any(String) },
    ]);
  });

  it('does not echo the rejected input in the details', () => {
    const pipe = new ZodValidationPipe(z.object({ password: z.string().min(12) }));

    const error = captureException(() => pipe.transform({ password: 'hunter2' }));

    expect(JSON.stringify(error.details)).not.toContain('hunter2');
  });
});
