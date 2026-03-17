import { defineConfig, devices } from '@playwright/test'
import { testUsers } from './tests/test_users'

// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'tests/playwright-report' }]],
  outputDir: 'tests/test-results',
  use: {
    baseURL: 'http://localhost:3000',

    trace: 'on-first-retry',
  },

  projects: Object.keys(testUsers).map((role) => ({
    name: role, // 'ADMIN', 'MNGR', etc.
    use: {
      ...devices['Desktop Chrome'],
      storageState: testUsers[role],
    },
  })),

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
