module.exports = {
  ...require('./jest.wifi.config.cjs'),
  testMatch: ['<rootDir>/__tests__/assistance/*.test.ts'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__tests__/native-stub.cjs',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
