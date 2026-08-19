import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { probeOverflow, probeTargets, probeInputs, probeSafeArea, probeSticky } from './probes'

/**
 * Mobile Lead Detail provenance / source card.
 *
 * Phone: the owner must see where the lead came from without hunting.
 * Desktop: the existing inbound context stays, and the mobile card must not mount.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const OVERFLOW_TOLERANCE = 1
const MIN_TARGET = 44
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

function nestedInteractive() {
  return Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  })
}

async function settle(page: Page) {
  await page.waitForSelector('nav[aria-label="ניווט ראשי"], .workspace-grid', { timeout: 60_000 })
  await page.waitForTimeout(800)
}

async function openFirstLead(page: Page) {
  await page.goto('/leads', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const card = page.locator('a[href*="/clients/"][href$="/summary"]').first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  const href = await card.getAttribute('href')
  await card.click()
  await page.waitForURL(/\/clients\/\d+\/summary/, { timeout: 60_000 })
  return href
}

test.describe('phone — lead provenance', () => {
  test('source card is visible, wraps, and does not overflow', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await openFirstLead(page)
    await settle(page)

    const card = page.getByTestId('lead-provenance-mobile')
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('dir', 'rtl')

    const heading = card.locator('h2')
    await expect(heading).toBeVisible()
    const cls = (await heading.getAttribute('class')) || ''
    expect(cls).toContain('break-words')
    expect(cls).not.toContain('truncate')

    expect(await page.locator('main#main-content table').count()).toBe(0)
    expect(await page.locator('main#main-content .workspace-grid').count()).toBe(0)

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    const real = overflow.elements.filter((e) => !e.scrollableAncestor)
    expect(real, JSON.stringify(real.slice(0, 3))).toHaveLength(0)

    const nested = await page.evaluate(nestedInteractive)
    expect(nested, `nested tap targets: ${JSON.stringify(nested)}`).toHaveLength(0)

    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk)).toHaveLength(0)

    const targets = await page.evaluate(probeTargets, MIN_TARGET)
    const undersized = targets.filter((t) => t.minSide < MIN_TARGET)
    expect(undersized, JSON.stringify(undersized.slice(0, 4))).toHaveLength(0)

    const safe = await page.evaluate(probeSafeArea)
    expect(safe.consumers.length).toBeGreaterThan(0)

    const sticky = await page.evaluate(probeSticky)
    expect(sticky.find((s) => s.selector.includes('nav'))).toBeTruthy()

    const box = await card.boundingBox()
    expect(box, 'provenance clipped').toBeTruthy()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.x).toBeGreaterThanOrEqual(-OVERFLOW_TOLERANCE)

    const cta = card.getByRole('link', { name: 'פתח את השיחה' })
    if ((await cta.count()) > 0) {
      const ctaBox = await cta.boundingBox()
      expect(ctaBox).toBeTruthy()
      expect(Math.min(ctaBox!.width, ctaBox!.height)).toBeGreaterThanOrEqual(MIN_TARGET)
    }

    await card.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `${SHOT_DIR}/${testInfo.project.name}-lead-provenance.png`,
      fullPage: false,
    })
  })
})

test.describe('desktop regression — lead provenance', () => {
  test('desktop summary keeps inbound context and never mounts the mobile card', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'desktop entity only')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.workspace-grid, table', { timeout: 60_000 })
    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)

    await page.goto('/clients/1/summary', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    expect(await page.locator('[data-testid="lead-provenance-mobile"]').count()).toBe(0)
    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)

    await page.screenshot({
      path: `${SHOT_DIR}/${testInfo.project.name}-lead-detail.png`,
      fullPage: false,
    })
  })
})
