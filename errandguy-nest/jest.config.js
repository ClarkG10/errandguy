/**
 * Unit-test config for the NestJS port. Kept deliberately minimal (transpile-
 * only via ts-jest isolatedModules — full type-checking stays with
 * `npm run typecheck`) so specs run fast without a NestJS app context.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'node',
};
