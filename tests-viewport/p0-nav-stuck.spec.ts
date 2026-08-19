import { test, expect, type Page } from '@playwright/test'

/**
 * P0 — client tab navigation must not leave a phone stuck on a skeleton.
 *
 * Hard refresh of the same URL always painted the destination. Tab-to-tab
 * client navigation (Leads → Today → Leads, or Leads → Inbox → Notifications
 * → Leads) sometimes left `loading.tsx` mounted forever because those files
 * awaited `headers()` under cacheComponents.
 *
 * This spec is real App Router navigation, not a jsdom render of a skeleton.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
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

const TAB = 'nav[aria-label="ניווט ראשי"]'
const SKELS =
  '[data-testid="leads-skeleton-mobile"], [data-testid="today-skeleton-mobile"], [data-testid="inbox-skeleton-mobile"], [data-testid="inbox-thread-skeleton-mobile"], [data-testid="notifications-skeleton-mobile"], [data-testid="more-skeleton-mobile"], [data-testid="mobile-chrome-skeleton"]'

const READY = {
  leads: '#lead-search',
  today:
    '#mobile-today-hero, h2:has-text("אין עכשיו מה לעשות"), h1:has-text("בואו נתחיל"), h1:has-text("אין עדיין לידים")',
  inbox: '#conversation-search',
  notifications: '[aria-label="סינון התראות"]',
  more: '#more-desktop',
} as const

async function waitDestination(page: Page, path: string, ready: string) {
  await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}(\\?|$)`), { timeout: 25_000 })
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 25_000 })
  await expect(page.locator(SKELS)).toHaveCount(0)
  await expect(page.locator(TAB)).toBeVisible()
}

async function tapTab(page: Page, href: string) {
  await page.locator(`${TAB} a[href="${href}"]`).tap()
}

test.describe('phone — client tab navigation never stays on a skeleton', () => {
  test('Leads → Today → Leads → Inbox → Notifications → More → Leads', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads)

    await tapTab(page, '/dashboard')
    await waitDestination(page, '/dashboard', READY.today)

    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads)

    await tapTab(page, '/inbox')
    await waitDestination(page, '/inbox', READY.inbox)

    const conversation = page.locator('main#main-content a[href*="conversation="]').first()
    if (await conversation.count()) {
      await conversation.click()
      await expect(page).toHaveURL(/conversation=/, { timeout: 25_000 })
      await expect(page.locator('[data-testid="inbox-thread-skeleton-mobile"]')).toHaveCount(0, { timeout: 25_000 })
      await expect(page.locator(TAB)).toBeVisible()
      await page.goBack()
      await waitDestination(page, '/inbox', READY.inbox)
    }

    await tapTab(page, '/notifications')
    await waitDestination(page, '/notifications', READY.notifications)

    await tapTab(page, '/m')
    await waitDestination(page, '/m', READY.more)

    const integrations = page.locator('a[href="/settings/integrations"]').first()
    if (await integrations.count()) {
      await integrations.click()
      await expect(page).toHaveURL(/\/settings\/integrations/, { timeout: 25_000 })
      await expect(page.locator('[data-testid="integrations-mobile"], [data-testid="ready-messages-mobile"]').first()).toBeVisible({
        timeout: 25_000,
      })
      await expect(page.locator('[data-testid="integrations-skeleton-mobile"], [data-testid="ready-messages-skeleton-mobile"]')).toHaveCount(0)
      await expect(page.locator(TAB)).toBeVisible()
      await page.goBack()
      await waitDestination(page, '/m', READY.more)
    }

    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads)

    const leadLink = page.locator('main#main-content a[href^="/clients/"]').first()
    if (await leadLink.count()) {
      await leadLink.click()
      await expect(page).toHaveURL(/\/clients\/\d+/, { timeout: 25_000 })
      await expect(page.locator('[data-testid="lead-detail-skeleton-mobile"]')).toHaveCount(0, { timeout: 25_000 })
      await expect(page.locator('main#main-content')).not.toHaveText(/^\s*טוען…\s*$/)
      await expect(page.locator(TAB)).toBeVisible()
      await page.goBack()
      await waitDestination(page, '/leads', READY.leads)
    }
  })

  test('back and forward after tab navigation settle on real content', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads)

    await tapTab(page, '/dashboard')
    await waitDestination(page, '/dashboard', READY.today)

    await tapTab(page, '/inbox')
    await waitDestination(page, '/inbox', READY.inbox)

    await page.goBack()
    await waitDestination(page, '/dashboard', READY.today)

    await page.goForward()
    await waitDestination(page, '/inbox', READY.inbox)

    await expect(page.locator(`${TAB} a[href="/leads"]`)).toBeEnabled()
    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads)
  })

  test('rapid tab taps still land on real Leads content', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads)

    await tapTab(page, '/dashboard')
    await tapTab(page, '/inbox')
    await tapTab(page, '/notifications')
    await tapTab(page, '/m')
    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads)
  })
})

test.describe('desktop — client navigation stays the desktop entity', () => {
  test('Leads → Today does not mount the mobile shell or skeletons', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'desktop entity only')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
    await expect(page.locator('.workspace-grid')).toBeVisible({ timeout: 60_000 })

    await page.locator('a[href="/dashboard"]').first().click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 25_000 })
    await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
    await expect(page.locator('[data-testid="today-skeleton-mobile"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="mobile-chrome-skeleton"]')).toHaveCount(0)
    await expect(page.locator('.workspace-grid')).toBeVisible()

    for (const path of ['/inbox', '/notifications', '/settings/integrations']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
      await expect(page.locator('[data-testid$="-skeleton-mobile"]')).toHaveCount(0)
      await expect(page.locator('.workspace-grid')).toBeVisible({ timeout: 25_000 })
    }
  })
})
