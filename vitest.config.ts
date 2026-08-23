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
    // Builds the test database ONCE per run (baseline + migrations). No-ops when
    // VITEST_NO_DB=1. See __tests__/globalSetup.ts.
    globalSetup: ['./__tests__/globalSetup.ts'],
  },
  resolve: {
    alias: {
      // mirrors tsconfig "paths": { "@/*": ["./*"] }
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
      // See the stub's header: lets server-only modules (connectors, stores)
      // be imported under test. No runtime capability is granted.
      'server-only': new URL('./__tests__/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
})
