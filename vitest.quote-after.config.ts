import { defineConfig } from 'vitest/config'

/**
 * The real Next.js after() and cron recovery, on a local production server. Run
 * on purpose after a guarded build; see docs/wa-quotes-validation-harness.md.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/live/after/run.live.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
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
