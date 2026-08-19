import { test, expect, type BrowserContext } from '@playwright/test'
import { probeOverflow, probeInputs } from './probes'

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const OVERFLOW_TOLERANCE = 1
const MIN_TARGET = 44

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
})

const isPhone = (name: string) => name.startsWith('phone-')
const isDesktop = (name: string) => name.startsWith('desktop-')

function nestedInteractive() {
  return Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  }).length
}

async function authCookie(context: BrowserContext, baseURL: string | undefined, token: string) {
  const url = new URL(baseURL || 'http://localhost:3100')
  await context.addCookies([
    {
      name: 'user',
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
}

test.describe('mobile WhatsApp thread polish', () => {
  test('thread uses WhatsApp colors; composer and long-press still work', async ({ page, context }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await authCookie(context, testInfo.project.use.baseURL as string | undefined, TOKEN)
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })

    const row = page.getByTestId('conversation-row').first()
    test.skip((await row.count()) === 0, 'no WhatsApp conversations in this workspace')
    await row.tap()
    await expect(page).toHaveURL(/conversation=/)

    const header = page.getByTestId('wa-thread-header')
    await expect(header).toBeVisible()
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 128, 105)')
    const shellHeader = page.locator('[data-mobile-header]')
    if ((await shellHeader.count()) > 0) {
      expect(await shellHeader.evaluate((el) => getComputedStyle(el).display)).toBe('none')
    }

    const thread = page.getByTestId('wa-thread')
    await expect(thread).toBeVisible()
    expect(await thread.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(236, 229, 221)')

    const outbound = page.locator('[data-testid="message-bubble"][data-direction="outbound"]').first()
    const inbound = page.locator('[data-testid="message-bubble"][data-direction="inbound"]').first()
    if ((await outbound.count()) > 0) {
      const bg = await outbound.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg).not.toMatch(/94,\s*105,\s*210|93,\s*106,\s*210|238,\s*239,\s*251/)
      expect(bg).toBe('rgb(217, 253, 211)')
    }
    if ((await inbound.count()) > 0) {
      expect(await inbound.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)')
    }

    const send = page.getByRole('button', { name: 'שלח' })
    if ((await send.count()) > 0) {
      expect(await send.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(37, 211, 102)')
      const box = await send.boundingBox()
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(MIN_TARGET - 0.5)
    }

    const ready = page.getByRole('button', { name: 'שלח הודעה מוכנה' })
    if ((await ready.count()) > 0) {
      await expect(ready).toBeVisible()
      const rBox = await ready.boundingBox()
      expect(Math.min(rBox!.width, rBox!.height)).toBeGreaterThanOrEqual(MIN_TARGET - 0.5)
    }

    const bubble = page.getByTestId('message-bubble').first()
    if ((await bubble.count()) > 0) {
      await bubble.dispatchEvent('contextmenu')
      await expect(page.getByRole('dialog', { name: 'פעולות הודעה' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'העתק' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'ערוך' })).toHaveCount(0)
      await page.getByRole('button', { name: 'סגירה' }).click()
    }

    expect(await page.evaluate(nestedInteractive)).toBe(0)
    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    expect(overflow.elements.filter((e) => !e.scrollableAncestor)).toHaveLength(0)
    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk)).toHaveLength(0)
  })
})

test.describe('mobile login alignment', () => {
  test('Google and Facebook icons sit on the same side', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await page.goto('/auth', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    const cluster = page.getByTestId('social-auth-buttons')
    await expect(cluster).toBeVisible()
    expect(await cluster.getAttribute('dir')).toBe('ltr')

    const googleIcon = cluster.locator('svg').first()
    await expect(googleIcon).toBeVisible()
    const gBox = await googleIcon.boundingBox()
    expect(gBox!.x).toBeLessThan(page.viewportSize()!.width / 2)

    const facebook = page.getByRole('button', { name: 'כניסה באמצעות Facebook' })
    if ((await facebook.count()) > 0) {
      const fbIcon = facebook.locator('svg')
      const fBox = await fbIcon.boundingBox()
      expect(Math.abs(gBox!.x - fBox!.x)).toBeLessThan(2)
      const fbBtn = await facebook.boundingBox()
      expect(fbBtn!.height).toBeGreaterThanOrEqual(MIN_TARGET - 0.5)
    }
  })
})

test.describe('desktop login and WhatsApp unchanged', () => {
  test('desktop /auth keeps the GIS button; desktop inbox is not the mobile thread', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'desktop entity only')
    await page.goto('/auth', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(600)
    expect(await page.getByTestId('social-auth-buttons').count()).toBe(0)
    expect(await page.locator('#gglBtn').count()).toBe(1)

    await authCookie(page.context(), testInfo.project.use.baseURL as string | undefined, TOKEN)
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    expect(await page.getByTestId('wa-thread-header').count()).toBe(0)
    expect(await page.getByTestId('wa-thread').count()).toBe(0)
  })
})
