module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/*.test.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['module:@react-native/babel-preset'] }] },
  moduleNameMapper: { '^react-native$': '<rootDir>/__tests__/native-stub.cjs' },
};
