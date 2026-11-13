import { isUuid, uuidv7 } from './uuid.js';

describe('uuidv7', () => {
  it('produces a version 7, RFC-variant UUID', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuid(id)).toBe(true);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 13, 12, 0, 0);
    const id = uuidv7(now);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('sorts by creation time across milliseconds', () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => uuidv7(1_700_000_000_000)));
    expect(ids.size).toBe(5_000);
  });
});

describe('isUuid', () => {
  it.each(['', 'abc', '00000000-0000-0000-0000-000000000000', 42, null, undefined])(
    'rejects %p',
    (value) => {
      expect(isUuid(value)).toBe(false);
    },
  );

  it('accepts upper-case input', () => {
    expect(isUuid(uuidv7().toUpperCase())).toBe(true);
  });
});
