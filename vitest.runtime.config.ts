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
    },
  },
})
