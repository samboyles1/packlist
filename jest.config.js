/** Unit tests only. The weight engine (S1-04) and unit formatting (D8) are pure
 *  TypeScript, so jest-expo's preset is heavier than strictly needed here — it
 *  is kept so component tests need no rework later. */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // `src/__tests__/helpers` holds shared fixtures and the SQLite test driver, not
  // test suites. jest's default testMatch treats everything under `__tests__` as a
  // suite, so it has to be excluded explicitly.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/__tests__/helpers/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
