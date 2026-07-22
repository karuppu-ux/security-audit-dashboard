export default {
  testEnvironment: 'node',
  // The source is native ESM; Jest runs it through the VM modules flag rather
  // than a Babel transform, so there is no build step to keep in sync.
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Spinning up mongodb-memory-server and building 12 indexes takes a moment on
  // a cold run; the default 5s is not enough on CI hardware.
  testTimeout: 60_000,
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  verbose: true,
};
