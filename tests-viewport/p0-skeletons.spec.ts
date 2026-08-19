import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

/**
 * P0-3 — prove the loading architecture on a real phone UA.
 *
 * Observed before this pass:
 *   · GET /leads at commit painted LeadsTableSkeleton (a real <table>)
 *     inside [data-mobile-workspace]
 *   · GET /inbox at commit painted the desktop size-32 spinner
 *
 * Tab-to-tab client navigation often keeps the previous page until the next
 * is ready, so loading.tsx may not flash. Hard navigation / first paint is
 * the surface this spec locks.
 *
 * `waitUntil: 'commit'` can be a streaming document whose `page.content()`
 * string does not yet contain testids. Locators wait for the streamed
 * skeleton; the hard lock is "never a desktop table / 3-pane / spinner".
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const SHOT_DIR = '/tmp/ux-pass-after'

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
  mkdirSync(SHOT_DIR, { recursive: true })
})

test.beforeEach(async ({ context, baseURL }) => {
  const url = new URL(baseURL || 'http://localhost:3100')
  await context.addCookies([
    {
      name: 'user',
      value: TOKEN,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
})

const isPhone = (name: string) => name.startsWith('phone-')
const isDesktop = (name: string) => name.startsWith('desktop-')

async function gotoCommit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'commit' })
}

test.describe('phone — hard navigation never paints desktop loading UI', () => {
  test('/leads commit is not a desktop table skeleton', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoCommit(page, '/leads')
    await expect(
      page
        .locator(
          '[data-testid="leads-skeleton-mobile"], [data-testid="mobile-chrome-skeleton"], [data-mobile-workspace], #lead-search',
        )
        .first(),
    ).toBeAttached({ timeout: 20_000 })
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-leads-commit.png` })

    await expect(page.locator('[data-testid="leads-route-skeleton"]')).toHaveCount(0)
    await expect(page.locator('table')).toHaveCount(0)
  })

  test('/inbox commit is not the size-32 desktop spinner', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoCommit(page, '/inbox')
    await expect(
      page
        .locator(
          '[data-testid="inbox-skeleton-mobile"], [data-testid="mobile-chrome-skeleton"], [data-mobile-workspace], #conversation-search',
        )
        .first(),
    ).toBeAttached({ timeout: 20_000 })
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-inbox-commit.png` })

    await expect(page.locator('[data-testid="inbox-route-skeleton"]')).toHaveCount(0)
    await expect(page.locator('.size-32')).toHaveCount(0)
  })

  test('settled /leads still has no desktop table', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })
    expect(await page.locator('main#main-content table').count()).toBe(0)
    expect(await page.locator('[data-testid=leads-route-skeleton]').count()).toBe(0)
    expect(await page.locator('[data-mobile-workspace]').count()).toBe(1)
  })
})

test.describe('desktop — loading and settled UI stay the desktop entity', () => {
  test('/leads does not receive mobile skeletons or the mobile shell', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'desktop entity only')
    await gotoCommit(page, '/leads')
    await expect(page.locator('[data-testid="leads-skeleton-mobile"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="mobile-chrome-skeleton"]')).toHaveCount(0)
    await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)

    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)
    expect(await page.locator('[data-testid=leads-skeleton-mobile]').count()).toBe(0)
    expect(await page.locator('.workspace-grid').count()).toBeGreaterThan(0)
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-leads-settled.png` })
  })
})
