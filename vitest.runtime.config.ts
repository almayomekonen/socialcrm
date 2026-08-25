import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    isolate: true,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['__tests__/runtime/**/*.test.ts'],
    setupFiles: ['./__tests__/runtime/setup.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
      // Phase 4.3: the worker's autonomous branch reaches server-only modules
      // (autonomousScope, the Agent loop). The same stub the unit config uses;
      // no runtime capability is granted.
      'server-only': new URL('./__tests__/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
})
