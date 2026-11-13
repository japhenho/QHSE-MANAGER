import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, paginationQuerySchema } from './pagination';
import { isLocale } from './locales';

describe('paginationQuerySchema', () => {
  it('applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });
  it('coerces query strings', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
    });
  });
  it('rejects a page size above the server limit', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });
});

describe('isLocale', () => {
  it('accepts supported locales only', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('pt')).toBe(false);
  });
});
