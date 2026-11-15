import { describe, expect, it } from 'vitest';
import {
  companyListQuerySchema,
  createCompanySchema,
  createSiteSchema,
  updateCompanySchema,
  updateSiteSchema,
} from './organization';
import { COUNTRY_CODES, isCountryCode, isCurrencyCode, isTimeZone } from './reference-data';

const SITE = {
  companyId: '0193a000-0000-7000-8000-000000000001',
  code: 'djeno',
  name: ' Terminal de Djeno ',
  countryCode: 'cg',
  timeZone: 'Africa/Brazzaville',
  currencyCode: 'xaf',
};

describe('reference data', () => {
  it('knows the countries, time zones and currencies of the initial market', () => {
    for (const country of ['CG', 'GA', 'CM', 'CD']) expect(isCountryCode(country)).toBe(true);
    for (const zone of [
      'Africa/Brazzaville',
      'Africa/Libreville',
      'Africa/Douala',
      'Africa/Kinshasa',
      'UTC',
    ]) {
      expect(isTimeZone(zone)).toBe(true);
    }
    for (const currency of ['XAF', 'CDF', 'USD', 'EUR'])
      expect(isCurrencyCode(currency)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isCountryCode('XX')).toBe(false);
    expect(isCountryCode('cg')).toBe(false);
    expect(isTimeZone('Africa/Atlantis')).toBe(false);
    expect(isTimeZone('GMT+1')).toBe(false);
    expect(isCurrencyCode('ZZZ')).toBe(false);
  });

  it('lists 249 distinct ISO country codes', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(249);
  });
});

describe('organisation schemas', () => {
  it('normalises codes to upper case and trims names', () => {
    expect(createCompanySchema.parse({ code: ' acme-cg ', name: '  ACME Congo ' })).toEqual({
      code: 'ACME-CG',
      name: 'ACME Congo',
    });
    expect(createSiteSchema.parse(SITE)).toEqual({
      ...SITE,
      code: 'DJENO',
      name: 'Terminal de Djeno',
      countryCode: 'CG',
      currencyCode: 'XAF',
    });
  });

  it.each([
    ['an unknown country', { countryCode: 'XX' }],
    ['an unknown time zone', { timeZone: 'Africa/Atlantis' }],
    ['an unknown currency', { currencyCode: 'ZZZ' }],
    ['a malformed code', { code: 'a b' }],
    ['an unexpected field', { tenantId: SITE.companyId }],
  ])('rejects a site with %s', (_label, change) => {
    expect(createSiteSchema.safeParse({ ...SITE, ...change }).success).toBe(false);
  });

  it('an update needs the version and at least one change, and cannot move the record', () => {
    expect(updateCompanySchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ name: 'New' }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ name: 'New', version: 1 }).success).toBe(true);
    expect(updateSiteSchema.safeParse({ companyId: SITE.companyId, version: 1 }).success).toBe(
      false,
    );
  });

  it('lists hide archived records and sort by name by default', () => {
    expect(companyListQuerySchema.parse({})).toMatchObject({
      status: 'active',
      sort: 'name',
      order: 'asc',
    });
    expect(companyListQuerySchema.safeParse({ sort: 'tenantId' }).success).toBe(false);
    expect(companyListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});
