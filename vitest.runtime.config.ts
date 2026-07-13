import { defineConfig } from 'vitest/config'

/**
 * Vitest config for the AI Runtime layer (Wave 1+). Isolated from the legacy
 * application test harness: it migrates only the decoupled ai_* runtime tables
 * (see __tests__/runtime/setup.ts) instead of the full application schema.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    isolate: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['__tests__/runtime/**/*.test.ts'],
    setupFiles: ['./__tests__/runtime/setup.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
    },
  },
})
