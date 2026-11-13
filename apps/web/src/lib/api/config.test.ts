import { describe, expect, it } from 'vitest';
import { ConfigError, parseApiBaseUrl } from './config';

describe('parseApiBaseUrl', () => {
  it('accepts an absolute http(s) URL and strips trailing slashes', () => {
    expect(parseApiBaseUrl('http://localhost:3000/api/v1')).toBe('http://localhost:3000/api/v1');
    expect(parseApiBaseUrl(' https://qhse.example/api/v1// ')).toBe('https://qhse.example/api/v1');
  });

  it('accepts a same-origin absolute path', () => {
    expect(parseApiBaseUrl('/api/v1/')).toBe('/api/v1');
  });

  it.each([
    undefined,
    '',
    '   ',
    42,
    'localhost:3000/api',
    'ftp://host/api',
    '//host/api',
    'api/v1',
  ])('rejects %j', (value) => {
    expect(() => parseApiBaseUrl(value)).toThrow(ConfigError);
  });

  it('rejects a URL with a query string or a fragment', () => {
    expect(() => parseApiBaseUrl('http://host/api?x=1')).toThrow(ConfigError);
    expect(() => parseApiBaseUrl('http://host/api#x')).toThrow(ConfigError);
  });
});
