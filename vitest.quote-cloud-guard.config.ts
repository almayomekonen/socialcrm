import { defineConfig } from 'vitest/config'

/**
 * Proves the cloud harness's own walls from the outside, by running it in dry
 * mode as a child with a planted object or a tight limit, and measures the quote
 * PDF's layout in real local Chrome output. Nothing leaves this machine.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/live/cloud/guard.live.ts', '__tests__/live/cloud/layout.live.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
      'server-only': new URL('./__tests__/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
})
