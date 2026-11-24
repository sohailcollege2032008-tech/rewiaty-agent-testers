const jestPreset = require('jest-expo/jest-preset');

module.exports = {
  ...jestPreset,
  testTimeout: 30000,
  maxWorkers: 2,
  resolver: '<rootDir>/jest.resolver.js',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  transformIgnorePatterns: [
    ...jestPreset.transformIgnorePatterns,
    '/node_modules/react-native/Libraries/Renderer/implementations/',
    '/node_modules/expo/virtual/streams\\.js$',
  ],
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
