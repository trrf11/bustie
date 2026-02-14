import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    isolate: true,
    restoreMocks: true,
    testTimeout: 10000,
  },
});
