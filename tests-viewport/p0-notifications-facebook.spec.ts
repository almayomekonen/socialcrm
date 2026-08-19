import { test, expect, type Page } from '@playwright/test'
import { probeOverflow, probeTargets } from './probes'

/**
 * P0 — notification read persistence + Facebook comments on the phone.
 *
 * Notifications: opening the list stamps seenAt (not readAt). An explicit read
 * (tap / סמן כנקרא / סימון הכל) posts /api/notifications/read. The התראות badge
 * follows NotificationContext, not the שיחות conversation count.
 *
 * Facebook comments: they live on /inbox/comments (same listPageComments query
 * as desktop). Mobile שיחות must expose the existing channel switch.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const OVERFLOW_TOLERANCE = 1
const MIN_TARGET = 44

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

function nestedInteractive() {
  return Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  }).length
}

async function gotoPath(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
}

async function tabLabel(page: Page, href: string) {
  return page.locator(`nav[aria-label="ניווט ראשי"] a[href="${href}"]`).getAttribute('aria-label')
}

test('phone: opening Notifications stamps seen, not read', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  const posts: { url: string; body: string }[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/notifications/')) {
      posts.push({ url: req.url(), body: req.postData() || '' })
    }
  })
  await gotoPath(page, '/notifications')
  await expect(page.locator('[data-testid="integrations-mobile"]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible()

  const readPosts = posts.filter((p) => p.url.includes('/api/notifications/read'))
  expect(readPosts, 'opening the list must not mark rows read').toHaveLength(0)
})

test('phone: tapping an unread row posts /api/notifications/read with ids', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  const readBodies: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/notifications/read')) {
      readBodies.push(req.postData() || '')
    }
  })
  await gotoPath(page, '/notifications')
  const unread = page.locator('[data-testid="notification-row"]').filter({ hasText: 'לא נקרא' }).first()
  if ((await unread.count()) === 0) {
    test.info().annotations.push({ type: 'note', description: 'no unread notification rows in this session' })
    return
  }
  await unread.tap()
  await expect.poll(() => readBodies.some((b) => b.includes('"ids"'))).toBe(true)
  expect(readBodies.some((b) => b.includes('"all":true'))).toBe(false)
})

test('phone: explicit mark-all-read posts the existing all:true contract and clears only the התראות badge', async ({
  page,
}, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  const readBodies: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/notifications/read')) {
      readBodies.push(req.postData() || '')
    }
  })
  await gotoPath(page, '/notifications')
  const inboxBefore = await tabLabel(page, '/inbox')
  const markAll = page.getByRole('button', { name: 'סימון הכל כנקרא' })
  if ((await markAll.count()) === 0) {
    test.info().annotations.push({ type: 'note', description: 'no unread notifications in this session' })
    return
  }
  await markAll.tap()
  await expect.poll(() => readBodies.some((b) => b.includes('"all":true'))).toBe(true)

  const notifTab = page.locator('nav[aria-label="ניווט ראשי"] a[href="/notifications"]')
  await expect(notifTab).toHaveAttribute('aria-label', 'התראות')
  expect(await tabLabel(page, '/inbox')).toBe(inboxBefore)

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await expect(page.locator('nav[aria-label="ניווט ראשי"] a[href="/notifications"]')).toHaveAttribute(
    'aria-label',
    'התראות',
  )
  expect(await tabLabel(page, '/inbox')).toBe(inboxBefore)
})

test('phone שיחות exposes Facebook comments via the existing channel switch', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  await gotoPath(page, '/inbox')
  const comments = page.getByRole('link', { name: /תגובות/ })
  await expect(comments).toBeVisible()
  await expect(comments).toHaveAttribute('href', '/inbox/comments')
  const box = await comments.boundingBox()
  expect(box).toBeTruthy()
  if (box) expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET - 1)

  await comments.tap()
  await expect(page).toHaveURL(/\/inbox\/comments/, { timeout: 60_000 })
  await expect(page.getByTestId('facebook-comments-mobile')).toBeVisible({ timeout: 60_000 })
  expect(await page.locator('table').count()).toBe(0)
  expect(await page.locator('.accordion').count()).toBe(0)
  expect(await page.evaluate(nestedInteractive)).toBe(0)

  const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
  const real = overflow.elements.filter((e) => !e.scrollableAncestor)
  expect(real, JSON.stringify(real.slice(0, 5))).toHaveLength(0)
})

test('phone comments page has 44px controls and no nested interactive', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  await gotoPath(page, '/inbox/comments')
  await expect(page.getByTestId('facebook-comments-mobile')).toBeVisible()
  const tooSmall = await page.evaluate(probeTargets, MIN_TARGET)
  const primary = tooSmall.filter((t) => /תגובות|שיחות|צור ליד/.test(t.name))
  expect(primary, JSON.stringify(primary)).toHaveLength(0)
})

test('desktop notifications and inbox comments stay the desktop surfaces', async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'desktop entity')
  await gotoPath(page, '/notifications')
  await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
  await expect(page.locator('[data-testid="notification-row"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="notifications-selection-bar"]')).toHaveCount(0)

  await gotoPath(page, '/inbox/comments')
  await expect(page.getByTestId('facebook-comments-mobile')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'תגובות מפייסבוק' })).toBeVisible()
  await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
})
