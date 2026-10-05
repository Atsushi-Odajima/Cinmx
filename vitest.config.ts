import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 20000,
  },
});
