import { defineConfig } from 'vitest/config'

/**
 * The Hebrew quote harness. Separate from the default suite: it is run on
 * purpose, and its self-test (no key, no network) is the default mode.
 *
 *   Self-test:  NODE_ENV=test npx vitest run --config vitest.quote-live.config.ts
 *   Real model: QUOTE_LIVE_MODE=model NODE_ENV=test npx vitest run --config vitest.quote-live.config.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/live/quote/run.live.ts'],
    fileParallelism: false,
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 120_000,
    setupFiles: ['./__tests__/setup.ts', './__tests__/live/quote/env.ts'],
    globalSetup: ['./__tests__/live/quote/globalSetup.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
      'server-only': new URL('./__tests__/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
})
