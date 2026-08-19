import { test, expect, type Page, type Request } from '@playwright/test'

/**
 * P0 — iPhone-equivalent client tab navigation must replace the skeleton.
 *
 * The Chromium+jsdom suite can pass while a real iPhone stays on loading.tsx
 * forever. This spec is the production failure mode:
 *   WebKit (Safari) + iPhone UA + touch + tap (not click)
 *   destination CONTENT must appear; URL change is not enough
 *   in-flight / aborted RSC is recorded
 *   skeleton still mounted after NAV_BUDGET_MS is a failure
 *
 * NAV_BUDGET_MS is a diagnosis deadline, not a hide-the-skeleton timeout.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const NAV_BUDGET_MS = 8_000

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
})

test.beforeEach(async ({ context, baseURL, page, browserName }, testInfo) => {
  const url = new URL(baseURL || 'http://localhost:3100')
  await context.addCookies([
    {
      name: 'user',
      value: TOKEN,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
  if (testInfo.project.name === 'phone-390x844-cpu6' && browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  }
})

const TAB = 'nav[aria-label="ניווט ראשי"]'
const SKELS =
  '[data-testid="leads-skeleton-mobile"], [data-testid="today-skeleton-mobile"], [data-testid="inbox-skeleton-mobile"], [data-testid="inbox-thread-skeleton-mobile"], [data-testid="notifications-skeleton-mobile"], [data-testid="more-skeleton-mobile"], [data-testid="integrations-skeleton-mobile"], [data-testid="mobile-chrome-skeleton"]'

const READY = {
  leads: '#lead-search',
  today:
    '#mobile-today-hero, h2:has-text("אין עכשיו מה לעשות"), h1:has-text("בואו נתחיל"), h1:has-text("אין עדיין לידים")',
  inbox: '#conversation-search',
  notifications: '[aria-label="סינון התראות"]',
  more: '#more-desktop',
  integrations: '[data-testid="integrations-mobile"], [data-testid="ready-messages-mobile"]',
} as const

function isNavRsc(req: Request): boolean {
  const url = req.url()
  if (!url.includes('_rsc=')) return false
  const headers = req.headers()
  return headers['next-router-prefetch'] !== '1'
}

function attachRscProbe(page: Page) {
  const pending = new Set<string>()
  const finished: { path: string; status: number; failed?: string }[] = []
  const consoleErrors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err).slice(0, 300))
  })
  page.on('request', (req) => {
    if (isNavRsc(req)) pending.add(req.url())
  })
  page.on('response', (res) => {
    if (!pending.has(res.url()) && !isNavRsc(res.request())) return
    pending.delete(res.url())
    const u = new URL(res.url())
    finished.push({ path: u.pathname + u.search, status: res.status() })
  })
  page.on('requestfailed', (req) => {
    if (!pending.has(req.url()) && !isNavRsc(req)) return
    pending.delete(req.url())
    const u = new URL(req.url())
    finished.push({ path: u.pathname + u.search, status: 0, failed: req.failure()?.errorText || 'failed' })
  })

  return {
    snapshot: () => ({
      pending: [...pending].map((u) => new URL(u).pathname + new URL(u).search),
      finished: finished.slice(-8),
      consoleErrors: consoleErrors.slice(-8),
    }),
  }
}

async function tapTab(page: Page, href: string) {
  await page.locator(`${TAB} a[href="${href}"]`).tap()
}

async function waitDestination(page: Page, path: string, ready: string, probe: ReturnType<typeof attachRscProbe>) {
  await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}(\\?|$)`), { timeout: NAV_BUDGET_MS })
  try {
    await expect(page.locator(ready).first()).toBeVisible({ timeout: NAV_BUDGET_MS })
    await expect(page.locator(SKELS)).toHaveCount(0)
    await expect(page.locator(TAB)).toBeVisible()
  } catch (err) {
    const rsc = probe.snapshot()
    const skel = await page.locator(SKELS).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    throw new Error(
      `destination ${path} did not settle within ${NAV_BUDGET_MS}ms. url=${page.url()} skeletons=${JSON.stringify(skel)} rsc=${JSON.stringify(rsc)} original=${String(err).slice(0, 400)}`,
    )
  }
}

test.describe('safari-equivalent phone — tab navigation commits real content', () => {

  test('Leads → Today → Leads → Inbox → Notifications → More → Integrations → Leads', async ({ page }) => {
    const probe = attachRscProbe(page)

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads, probe)

    await tapTab(page, '/dashboard')
    await waitDestination(page, '/dashboard', READY.today, probe)

    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads, probe)

    await tapTab(page, '/inbox')
    await waitDestination(page, '/inbox', READY.inbox, probe)

    await tapTab(page, '/notifications')
    await waitDestination(page, '/notifications', READY.notifications, probe)

    await tapTab(page, '/m')
    await waitDestination(page, '/m', READY.more, probe)

    const integrations = page.locator('a[href="/settings/integrations"]').first()
    if (await integrations.count()) {
      await integrations.tap()
      await waitDestination(page, '/settings/integrations', READY.integrations, probe)
    }

    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads, probe)
  })

  test('back and forward after tab navigation settle on real content', async ({ page }) => {
    const probe = attachRscProbe(page)

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads, probe)

    await tapTab(page, '/dashboard')
    await waitDestination(page, '/dashboard', READY.today, probe)

    await tapTab(page, '/inbox')
    await waitDestination(page, '/inbox', READY.inbox, probe)

    await page.goBack()
    await waitDestination(page, '/dashboard', READY.today, probe)

    await page.goForward()
    await waitDestination(page, '/inbox', READY.inbox, probe)
  })

  test('rapid tab taps still land on real Leads content', async ({ page }) => {
    const probe = attachRscProbe(page)

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads, probe)

    await tapTab(page, '/dashboard')
    await tapTab(page, '/inbox')
    await tapTab(page, '/notifications')
    await tapTab(page, '/m')
    await tapTab(page, '/leads')
    await waitDestination(page, '/leads', READY.leads, probe)
  })
})
