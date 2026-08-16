import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../tests'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Tests live in ../tests, outside this package, so bare npm imports from a
    // test file resolve by walking up to /repo/node_modules — which does not
    // exist (the repo root has no package.json). Map the packages tests import
    // directly into app/node_modules. Deliberately NOT moduleDirectories: that
    // perturbs nested resolution and breaks htmlparser2's own 'entities' copy.
    '^zod$': '<rootDir>/node_modules/zod',
    // @noble/hashes ships ESM-only so Jest (CommonJS) cannot load it.
    // Redirect to a local shim that wraps Node's built-in crypto for the
    // test environment only. Hash tests are algorithm-agnostic.
    '^@noble/hashes/blake3(\\.js)?$': '<rootDir>/../tests/__mocks__/noble-blake3-shim.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  testMatch: ['**/*.test.ts'],
};

export default config;
