// End-to-end tests: boot the real Nest application; a PostgreSQL database is required.
/** @type {import('jest').Config} */
export default {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testEnvironment: 'node',
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // The app is native ESM (NestJS 12 is ESM-only): run TypeScript as ESM and map the
  // mandatory ".js" import specifiers back to their ".ts" sources.
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 30000,
};
