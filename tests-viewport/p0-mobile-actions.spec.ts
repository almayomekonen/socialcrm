import { test, expect, type Page } from '@playwright/test'

/**
 * Mobile long-press / selection / lead actions.
 *
 * Phone entity only for the interaction tests. Desktop projects assert the
 * mobile chrome is absent and the desktop inbox is unchanged.
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
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
})

const isPhone = (name: string) => name.startsWith('phone-')
const isDesktop = (name: string) => name.startsWith('desktop-')
const TAB = 'nav[aria-label="ניווט ראשי"]'
const SKELS =
  '[data-testid="leads-skeleton-mobile"], [data-testid="today-skeleton-mobile"], [data-testid="inbox-skeleton-mobile"], [data-testid="inbox-thread-skeleton-mobile"], [data-testid="notifications-skeleton-mobile"], [data-testid="more-skeleton-mobile"], [data-testid="integrations-skeleton-mobile"], [data-testid="mobile-chrome-skeleton"]'

const READY = {
  leads: '#lead-search',
  today:
    '#mobile-today-hero, h2:has-text("אין עכשיו מה לעשות"), h1:has-text("בואו נתחיל"), h1:has-text("אין עדיין לידים")',
  inbox: '#conversation-search',
  notifications: '[aria-label="סינון התראות"]',
  more: '#more-desktop, [data-testid="more-desktop"]',
  integrations: '[data-testid="integrations-mobile"], [data-testid="ready-messages-mobile"]',
} as const

async function waitDestination(page: Page, path: string, ready: string) {
  await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}(\\?|$)`), { timeout: 25_000 })
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 25_000 })
  await expect(page.locator(SKELS)).toHaveCount(0)
}

async function tapTab(page: Page, href: string) {
  await page.locator(`${TAB} a[href="${href}"]`).tap()
}

async function longPress(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  if (!box) return
  const page = locator.page()
  await page.mouse.move(box.x + Math.min(24, box.width / 2), box.y + Math.min(24, box.height / 2))
  await page.mouse.down()
  await page.waitForTimeout(560)
  await page.mouse.up()
}

test.describe('phone — inbox selection', () => {
  test('tap opens a thread; long press enters selection without deleting', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'phone entity only')
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
    await waitDestination(page, '/inbox', READY.inbox)
    await expect(page.locator(TAB)).toBeVisible()

    const row = page.getByTestId('conversation-row').first()
    if ((await row.count()) === 0) {
      await expect(page.getByRole('heading', { name: /אין עדיין שיחות|לא נמצאו שיחות/ })).toBeVisible()
      return
    }

    await longPress(row)
    await expect(page.getByTestId('inbox-selection-bar')).toBeVisible()
    await expect(page.getByTestId('inbox-selection-bar')).toContainText('נבחרו')
    await expect(page).toHaveURL(/\/inbox\/?(\?q=|$)/)
    await expect(page.getByRole('button', { name: 'מחק' })).toBeVisible()
    await page.getByTestId('inbox-selection-bar').getByRole('button', { name: 'ביטול' }).tap()
    await expect(page.getByTestId('inbox-selection-bar')).toHaveCount(0)

    await row.tap()
    await expect(page).toHaveURL(/conversation=/)
    await expect(page.getByRole('link', { name: 'חזרה לשיחות' })).toBeVisible()
    await expect(page.locator(SKELS)).toHaveCount(0)
  })

  test('long press during a drag does not enter selection', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'phone entity only')
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
    await waitDestination(page, '/inbox', READY.inbox)
    const row = page.getByTestId('conversation-row').first()
    if ((await row.count()) === 0) return
    const box = await row.boundingBox()
    if (!box) return
    await page.mouse.move(box.x + 24, box.y + 24)
    await page.mouse.down()
    await page.mouse.move(box.x + 24, box.y + 90, { steps: 8 })
    await page.waitForTimeout(560)
    await page.mouse.up()
    await expect(page.getByTestId('inbox-selection-bar')).toHaveCount(0)
  })
})

test.describe('phone — conversation copy sheet', () => {
  test('long press on a message opens copy, not edit/delete', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'phone entity only')
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
    await waitDestination(page, '/inbox', READY.inbox)
    const row = page.getByTestId('conversation-row').first()
    if ((await row.count()) === 0) return
    await row.tap()
    await expect(page).toHaveURL(/conversation=/)
    const bubble = page.getByTestId('message-bubble').last()
    if ((await bubble.count()) === 0) return
    await longPress(bubble)
    await expect(page.getByRole('dialog', { name: 'פעולות הודעה' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'העתק' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ערוך' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'פעולות הודעה' }).getByRole('button', { name: 'מחק' })).toHaveCount(0)
    await page.getByRole('button', { name: 'ביטול' }).tap()
  })
})

test.describe('phone — lead actions', () => {
  test('פעולות opens a sheet; delete is confirm-gated', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'phone entity only')
    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await waitDestination(page, '/leads', READY.leads)
    const card = page.locator('a[href*="/clients/"][href$="/summary"]').first()
    if ((await card.count()) === 0) return
    await card.tap()
    await expect(page).toHaveURL(/\/clients\/\d+\/summary/)
    await expect(page.getByRole('button', { name: 'פעולות' })).toBeVisible()
    await expect(page.locator(SKELS)).toHaveCount(0)
    await page.getByRole('button', { name: 'פעולות' }).tap()
    await expect(page.getByRole('dialog', { name: 'פעולות' })).toBeVisible()
    await page.getByRole('button', { name: 'מחיקת ליד' }).tap()
    await expect(page.getByRole('dialog', { name: 'מחיקת ליד' })).toBeVisible()
    await page.getByRole('button', { name: 'ביטול' }).tap()
    await expect(page.getByRole('dialog', { name: 'מחיקת ליד' })).toHaveCount(0)
    await expect(page).toHaveURL(/\/clients\/\d+\/summary/)
  })
})

test.describe('phone — ready messages Hebrew titles', () => {
  test('ready messages workspace is Hebrew, not a desktop table', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'phone entity only')
    await page.goto('/settings/integrations?section=templates', { waitUntil: 'domcontentloaded' })
    const ready = page.getByTestId('ready-messages-mobile')
    if ((await ready.count()) === 0) return
    await expect(ready).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('heading', { name: 'הודעות מוכנות' })).toBeVisible()
    await expect(page.locator('table')).toHaveCount(0)
    await expect(page.getByText('lead_first_contact')).toHaveCount(0)
  })
})

test.describe('phone — tab navigation still lands on content', () => {
  test('Today Leads Inbox Notifications More Integrations', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'phone entity only')
    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(TAB, { timeout: 60_000 })
    await waitDestination(page, '/leads', READY.leads)
    await tapTab(page, '/dashboard')
    await waitDestination(page, '/dashboard', READY.today)
    await tapTab(page, '/inbox')
    await waitDestination(page, '/inbox', READY.inbox)
    await tapTab(page, '/notifications')
    await waitDestination(page, '/notifications', READY.notifications)
    await tapTab(page, '/m')
    await waitDestination(page, '/m', READY.more)
    const integrations = page.locator('a[href="/settings/integrations"]').first()
    if ((await integrations.count()) > 0) {
      await integrations.tap()
      await expect(page.locator(SKELS)).toHaveCount(0)
    }
  })
})

test.describe('desktop — mobile chrome absent', () => {
  test('1280/1440 keep desktop inbox and lead detail', async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), 'desktop entity only')
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
    await expect(page.getByTestId('inbox-selection-bar')).toHaveCount(0)
    await expect(page.getByTestId('conversation-row')).toHaveCount(0)

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
    await expect(page.locator('.workspace-grid')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('inbox-selection-bar')).toHaveCount(0)

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
    await expect(page.locator('.workspace-grid')).toBeVisible({ timeout: 25_000 })
  })
})
