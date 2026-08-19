import { test, expect, type Page } from '@playwright/test'
import { probeOverflow, probeTargets, probeInputs } from './probes'

/**
 * P0-E — Integrations + Ready Messages, phone vs desktop entity.
 *
 * Phone must see status cards (`data-testid=integrations-mobile`), never the
 * desktop UrlSyncedAccordion. Desktop must keep LeadSourcesSection unchanged.
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

async function gotoIntegrations(page: Page, section?: string) {
  const q = section ? `?section=${section}` : ''
  await page.goto(`/settings/integrations${q}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

test('phone Integrations is cards, not the desktop accordion', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  await gotoIntegrations(page)

  await expect(page.getByTestId('integrations-mobile')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'אינטגרציות' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'וואטסאפ' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'פייסבוק ואינסטגרם' })).toBeVisible()
  expect(await page.locator('.accordion').count()).toBe(0)
  expect(await page.locator('table').count()).toBe(0)

  const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
  const real = overflow.elements.filter((e) => !e.scrollableAncestor)
  expect(real, JSON.stringify(real.slice(0, 5))).toHaveLength(0)

  const nested = await page.evaluate(nestedInteractive)
  expect(nested).toBe(0)
})

test('phone Ready Messages screen is a list, not a table', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  await gotoIntegrations(page, 'templates')

  const mobileList = page.getByTestId('ready-messages-mobile')
  const gated = page.getByRole('heading', { name: 'הודעות מוכנות' })
  await expect(mobileList.or(gated)).toBeVisible()
  expect(await page.locator('table').count()).toBe(0)
  expect(await page.locator('.accordion').count()).toBe(0)

  const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
  const real = overflow.elements.filter((e) => !e.scrollableAncestor)
  expect(real, JSON.stringify(real.slice(0, 5))).toHaveLength(0)
})

test('phone primary cards are 44px and inputs are not zoom-risk', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  await gotoIntegrations(page)

  const tooSmall = await page.evaluate(probeTargets, MIN_TARGET)
  const primary = tooSmall.filter((t) =>
    /חבר|ניהול|הודעה מוכנה|וואטסאפ|פייסבוק/.test(t.name),
  )
  expect(primary, JSON.stringify(primary)).toHaveLength(0)

  const inputs = await page.evaluate(probeInputs)
  expect(
    inputs.filter((i) => i.zoomRisk),
    JSON.stringify(inputs.filter((i) => i.zoomRisk)),
  ).toHaveLength(0)
})

test('phone WhatsApp manage sheet stays in bounds after open', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo.project.name), 'phone entity')
  await gotoIntegrations(page)

  const cta = page.locator('article').filter({ has: page.getByRole('heading', { name: 'וואטסאפ' }) }).getByRole('button')
  await cta.click()
  await page.waitForTimeout(250)
  const dialog = page.getByRole('dialog', { name: 'וואטסאפ' })
  await expect(dialog).toBeVisible()

  const box = await dialog.boundingBox()
  expect(box).toBeTruthy()
  if (box) {
    const vw = testInfo.project.use.viewport!.width
    const vh = testInfo.project.use.viewport!.height
    expect(box.x).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 1)
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 8)
  }
})

test('desktop Integrations is still the accordion — no mobile shell', async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'desktop entity')
  await gotoIntegrations(page)

  await expect(page.getByTestId('integrations-mobile')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'אינטגרציות' })).toBeVisible()
  expect(await page.locator('.accordion').count()).toBeGreaterThan(0)
  await expect(page.getByText('מקורות לידים')).toBeVisible()
  await expect(page.locator('[data-mobile-workspace]')).toHaveCount(0)
})
