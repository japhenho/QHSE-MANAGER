import { describe, expect, it } from 'vitest';
import { loginRequestSchema, newPasswordSchema } from './auth';

describe('loginRequestSchema', () => {
  it('normalises the organisation code and the e-mail, never the password', () => {
    expect(
      loginRequestSchema.parse({
        organization: '  ACME-Congo ',
        email: ' Jane.Doe@Example.TEST ',
        password: '  Spaces kept  ',
      }),
    ).toEqual({
      organization: 'acme-congo',
      email: 'jane.doe@example.test',
      password: '  Spaces kept  ',
    });
  });

  it.each([
    { organization: 'ab', email: 'a@example.test', password: 'x' },
    { organization: 'acme', email: 'not-an-email', password: 'x' },
    { organization: 'acme', email: 'a@example.test', password: '' },
    { organization: 'acme', email: 'a@example.test', password: 'x'.repeat(257) },
  ])('rejects %j', (input) => {
    expect(loginRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe('newPasswordSchema', () => {
  it('requires at least 12 characters', () => {
    expect(newPasswordSchema.safeParse('short-pass').success).toBe(false);
    expect(newPasswordSchema.safeParse('a long enough passphrase').success).toBe(true);
  });
});
