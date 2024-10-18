import type { Config } from 'jest';

const config: Config = {
  clearMocks: true,
  preset: 'ts-jest',
  restoreMocks: true,
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: ['TS151001'] } }],
  },
};

export default config;
