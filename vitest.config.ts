import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000, // 2 minutes for canister tests
    hookTimeout: 120000,
    include: ['packages/canisters/**/test/**/*.test.ts'],
    globalSetup: ['./packages/canisters/final_score/test/global-setup.ts'],
  },
});
