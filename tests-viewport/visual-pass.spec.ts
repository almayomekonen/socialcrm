import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { probeOverflow, probeTargets, probeInputs, probeSafeArea, probeSticky } from './probes'

/**
 * Visual pass — mobile Leads filter bar + Today presentation.
 *
 * Behaviour from P0-1 (Today sibling actions, WhatsApp, Call, open) is a
 * regression floor, not the point of this file. This spec locks the visual
 * grammar: no floating filter pills, white Today hero, 44px targets, desktop
 * entity untouched.
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

async function settle(page: Page, extra?: string) {
  await page.waitForSelector('nav[aria-label="ניווט ראשי"], .workspace-grid', { timeout: 60_000 })
  if (extra) await page.waitForSelector(extra, { timeout: 60_000 })
  await page.waitForTimeout(800)
}

test.describe('phone — Leads filter', () => {
  test('active filters are toolbar controls, not capsules', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await page.goto('/leads?status=new,contacted,interested', { waitUntil: 'domcontentloaded' })
    await settle(page, '#lead-search')

    const chip = page.getByRole('button', { name: 'הסר בטיפול' })
    await expect(chip).toBeVisible()
    await expect(page.getByRole('button', { name: 'נקה הכל' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'סינון לפי סטטוס, 3 נבחרו' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'הסר חדש' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'הסר מעוניין' })).toBeVisible()
    await expect(page.getByRole('searchbox')).toBeVisible()

    const cls = (await chip.getAttribute('class')) || ''
    const tokens = cls.split(/\s+/)
    expect(tokens, 'active filter still a pill').not.toContain('rounded-full')
    expect(tokens, 'active filter still a grey capsule').not.toContain('bg-gray-50')
    expect(tokens).toContain('h-11')

    const strip = page.getByTestId('lead-active-filters')
    await expect(strip).toBeVisible()

    const searchBox = await page.locator('#lead-search').boundingBox()
    const filterBox = await page.getByRole('button', { name: /סינון לפי סטטוס/ }).boundingBox()
    const stripBox = await strip.boundingBox()
    expect(searchBox, 'search input').toBeTruthy()
    expect(filterBox, 'filter button').toBeTruthy()
    expect(stripBox, 'active filters').toBeTruthy()
    expect(Math.abs(searchBox!.y - filterBox!.y), 'search and filter not on the same row').toBeLessThan(4)
    expect(filterBox!.width).toBeGreaterThanOrEqual(MIN_TARGET)
    expect(filterBox!.height).toBeGreaterThanOrEqual(MIN_TARGET)
    expect(stripBox!.y, 'active filters must sit below the search/filter row').toBeGreaterThan(
      searchBox!.y + searchBox!.height - 1,
    )

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    const real = overflow.elements.filter((e) => !e.scrollableAncestor)
    expect(real, JSON.stringify(real.slice(0, 3))).toHaveLength(0)

    const nested = await page.evaluate(nestedInteractive)
    expect(nested, `nested tap targets: ${JSON.stringify(nested)}`).toHaveLength(0)

    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk)).toHaveLength(0)

    const box = await chip.boundingBox()
    expect(box, 'individual-clear hit area').toBeTruthy()
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(MIN_TARGET)

    await page.screenshot({
      path: `${SHOT_DIR}/${testInfo.project.name}-leads-filtered.png`,
    })
  })

  test('clear one, clear all, and search still navigate', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/leads?status=contacted', { waitUntil: 'domcontentloaded' })
    await settle(page, '#lead-search')
    await page.getByRole('button', { name: 'הסר בטיפול' }).click()
    await page.waitForURL((u) => !u.searchParams.has('status'), { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'הסר בטיפול' })).toHaveCount(0)

    await page.goto('/leads?status=contacted', { waitUntil: 'domcontentloaded' })
    await settle(page, '#lead-search')
    await page.getByRole('button', { name: 'נקה הכל' }).click()
    await page.waitForURL((u) => u.pathname.endsWith('/leads') && u.search === '', { timeout: 30_000 })

    await page.fill('#lead-search', 'שירה')
    await page.locator('#lead-search').press('Enter')
    await page.waitForURL(/q=/, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'נקה חיפוש' })).toBeVisible()
  })
})

test.describe('phone — Today visual + P0-1 floor', () => {
  test('hero is a white card and contact actions remain', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await settle(page, '#mobile-today-hero')

    const heroClass = await page.locator('#mobile-today-hero').evaluate((el) => el.closest('section')?.className || '')
    expect(heroClass).toContain('bg-white')
    expect(heroClass).not.toContain('bg-primary-tint')

    const later = page.getByRole('heading', { name: 'אחר כך' })
    if (await later.count()) {
      expect((await later.getAttribute('class')) || '').not.toContain('uppercase')
    }

    const nested = await page.evaluate(nestedInteractive)
    expect(nested, `nested tap targets: ${JSON.stringify(nested)}`).toHaveLength(0)

    // The WhatsApp control is a BUTTON when the workspace has WhatsApp connected
    // and an ANCHOR (wa.me handoff) when it does not — one doctrine, two shapes.
    // Match on the accessible name so the assertion survives both.
    const wa = page.locator('main#main-content [aria-label^="וואטסאפ"]')
    const call = page.locator('main#main-content a[aria-label^="התקשר"]')
    expect(await wa.count()).toBeGreaterThan(0)
    expect(await call.count()).toBeGreaterThan(0)
    // wa.me anchors are legitimate now; malformed ones never are.
    for (const href of await page.locator('a[href*="wa.me"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href') ?? ''),
    )) {
      expect(href).toMatch(/^https:\/\/wa\.me\/\d{9,15}$/)
    }
    await expect(page.getByRole('link', { name: /^פתח / }).first()).toBeVisible()

    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-today.png` })
  })
})

test.describe('phone — layout probes + grammar', () => {
  const routes = [
    { path: '/leads', shot: 'leads' },
    { path: '/dashboard', shot: 'today' },
    { path: '/inbox', shot: 'inbox' },
    { path: '/notifications', shot: 'notifications' },
    { path: '/settings/integrations', shot: 'integrations' },
  ] as const

  for (const route of routes) {
    test(`${route.path} has no overflow, table, grid, or sub-44 primary targets`, async ({ page }, testInfo) => {
      test.skip(!isPhone(testInfo.project.name), 'phone entity only')
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await settle(page)

      const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
      const real = overflow.elements.filter((e) => !e.scrollableAncestor)
      expect(real, JSON.stringify(real.slice(0, 3))).toHaveLength(0)

      const targets = await page.evaluate(probeTargets, MIN_TARGET)
      const undersized = targets.filter((t) => t.minSide < MIN_TARGET)
      expect(undersized, JSON.stringify(undersized.slice(0, 4))).toHaveLength(0)

      const inputs = await page.evaluate(probeInputs)
      expect(inputs.filter((i) => i.zoomRisk)).toHaveLength(0)

      const safe = await page.evaluate(probeSafeArea)
      expect(safe.consumers.length).toBeGreaterThan(0)
      expect(safe.nestedPairs).toHaveLength(0)

      expect(await page.locator('main#main-content table').count()).toBe(0)
      expect(await page.locator('main#main-content .workspace-grid').count()).toBe(0)
      expect(await page.locator('[data-mobile-workspace]').count()).toBe(1)

      const sticky = await page.evaluate(probeSticky)
      expect(sticky.find((s) => s.selector.includes('nav'))).toBeTruthy()

      await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-${route.shot}.png` })
    })
  }
})

test.describe('desktop regression', () => {
  test('Leads and Today stay the desktop entity', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'desktop entity only')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('a[href="/inbox"]', { state: 'attached', timeout: 60_000 })
    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)
    expect(await page.locator('#mobile-today-hero').count()).toBe(0)
    expect(await page.locator('.workspace-grid').count()).toBeGreaterThan(0)
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-today.png` })

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)
    expect(await page.locator('#lead-search').count()).toBe(0)
    expect(await page.locator('.workspace-grid').count()).toBeGreaterThan(0)
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-leads.png` })
  })
})
