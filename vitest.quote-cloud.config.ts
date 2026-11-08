import { defineConfig } from 'vitest/config'

/**
 * The cloud PDF harness. Separate from the default suite: it is run on
 * purpose, and dry mode (nothing leaves this machine) is the default.
 *
 *   Dry run: NODE_ENV=test npx vitest run --config vitest.quote-cloud.config.ts
 *   Real services need separate approval: see __tests__/live/cloud/env.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/live/cloud/run.live.ts'],
    fileParallelism: false,
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 120_000,
    setupFiles: ['./__tests__/setup.ts', './__tests__/live/cloud/env.ts'],
    globalSetup: ['./__tests__/live/quote/globalSetup.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
      'server-only': new URL('./__tests__/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
})
