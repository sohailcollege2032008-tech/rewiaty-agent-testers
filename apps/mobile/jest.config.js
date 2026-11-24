const jestPreset = require('jest-expo/jest-preset');

module.exports = {
  ...jestPreset,
  testTimeout: 30000,
  maxWorkers: 2,
  resolver: '<rootDir>/jest.resolver.js',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  transform: {
    ...jestPreset.transform,
    '^.+\\.md$': require.resolve('jest-expo/src/preset/assetFileTransformer.js'),
  },
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    ...jestPreset.moduleNameMapper,
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@rewiaty/book-format$': '<rootDir>/../../packages/book-format/src/index.ts',
  },
};
