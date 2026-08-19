import { defineConfig, devices } from '@playwright/test'

/**
 * A2a — the mobile viewport MEASUREMENT run.
 *
 * SEPARATE FROM `playwright.config.ts` ON PURPOSE. That config fans every spec
 * out across four ROLE projects on Desktop Chrome with stored auth. This run
 * needs the opposite shape: one project per VIEWPORT, real touch emulation, and
 * a session minted at run time. Sharing a config would have run the billing and
 * sales specs at 360px and this spec four times per role.
 *
 * `testDir` is its own top-level directory so the default config cannot pick
 * these specs up and the two runs can never contaminate each other.
 *
 * TOUCH EMULATION IS LOAD-BEARING, not a detail. `lib/css/main.css` puts
 * `.tap-44`'s hit-area pseudo-element behind `@media (pointer: coarse)` and the
 * `.press` pressed state behind `@media (hover: none)`. Measured in a plain
 * desktop Chromium neither rule applies, so every tap target would be reported
 * as undersized and every pressed state as missing — a page of fabricated
 * defects. `isMobile` + `hasTouch` turn both media features on.
 *
 * DEVICE CLASS FOLLOWS THE User-Agent, exactly as the product does
 * (`lib/device.ts`). So the projects are split by the ENTITY under test:
 *   · 360–430  iPhone UA   → PHONE entity   (the mobile workspace)
 *   · 768      iPad UA     → DESKTOP entity (the new `tablet` breakpoint band)
 *   · 1280+    desktop UA  → DESKTOP entity (regression)
 * Pointing a phone UA at 768px would measure a layout no real user can reach.
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const phone = (name: string, width: number, height: number) => ({
  name,
  testIgnore: /p0-nav-stuck-safari/,
  use: {
    ...devices['Desktop Chrome'],
    userAgent: IPHONE_UA,
    viewport: { width, height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
})

export default defineConfig({
  testDir: './tests-viewport',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'tests-viewport/.results',
  timeout: 120_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.MOBILE_QA_BASE_URL || 'http://localhost:3000',
    // The dev server compiles routes on first hit; the first navigation to a
    // cold route can genuinely take tens of seconds.
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
  },

  projects: [
    phone('phone-360x800', 360, 800),
    phone('phone-375x812', 375, 812),
    phone('phone-390x844', 390, 844),
    phone('phone-430x932', 430, 932),
    {
      name: 'phone-390x844-webkit',
      testMatch: /p0-nav-stuck-safari|p0-mobile-actions|p0-notifications-facebook|p0-whatsapp-login-polish/,
      use: {
        browserName: 'webkit',
        userAgent: IPHONE_UA,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      // 6× CPU throttle: the React ping/loading.tsx hang is production-only and
      // much more likely on a real phone CPU than on a fast Mac (vercel/next.js#86151).
      name: 'phone-390x844-cpu6',
      testMatch: /p0-nav-stuck-safari/,
      use: {
        ...devices['Desktop Chrome'],
        userAgent: IPHONE_UA,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-768x1024',
      testIgnore: /p0-nav-stuck-safari/,
      use: {
        ...devices['Desktop Chrome'],
        userAgent: IPAD_UA,
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-1280x800',
      testIgnore: /p0-nav-stuck-safari/,
      use: { ...devices['Desktop Chrome'], userAgent: DESKTOP_UA, viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'desktop-1440x900',
      testIgnore: /p0-nav-stuck-safari/,
      use: { ...devices['Desktop Chrome'], userAgent: DESKTOP_UA, viewport: { width: 1440, height: 900 } },
    },
  ],

  /**
   * Reuses the running dev server rather than starting one. Next holds a lock at
   * `.next/dev/lock`, so a second `next dev` cannot start alongside the one the
   * developer already has open.
   */
  webServer: {
    command: 'npm run dev',
    url: process.env.MOBILE_QA_BASE_URL || 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
