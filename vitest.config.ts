import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Each test file gets its own isolated module registry so vi.mock hoisting works
    isolate: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['./__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      // mirrors tsconfig "paths": { "@/*": ["./*"] }
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
    },
  },
})
