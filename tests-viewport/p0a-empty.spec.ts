import { test, expect, type Page } from '@playwright/test'
import { probeOverflow, probeTargets, probeInputs } from './probes'

/**
 * P0-A — mobile first-run / add-lead / import, plus desktop /leads regression.
 *
 * Empty-workspace interactions (open the add sheet, open import) run only when
 * the QA account actually has no leads. Layout probes always run.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const OVERFLOW_TOLERANCE = 1
const MIN_TARGET = 44

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
})

test.beforeEach(async ({ context, baseURL }) => {
  const url = new URL(baseURL || 'http://localhost:3000')
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

function nestedInteractive() {
  return Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  }).length
}

async function gotoLeads(page: Page) {
  await page.goto('/leads', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
}

async function isFirstRun(page: Page) {
  return page.getByRole('button', { name: 'הוסף ליד' }).count().then((n) => n > 0)
}

test.describe('P0-A mobile first-run', () => {
  test('never tells the user to continue on a computer', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoLeads(page)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(400)
    const body = await page.locator('main#main-content').innerText()
    expect(body).not.toMatch(/זמינים כרגע במחשב|זמינים במחשב/)
  })

  test('layout: no overflow, no table, no nested interactive, targets, zoom', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoLeads(page)
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    expect(overflow.elements, `overflow: ${JSON.stringify(overflow.elements.slice(0, 3))}`).toHaveLength(0)

    expect(await page.locator('main#main-content table').count(), 'desktop table in the phone entity').toBe(0)
    expect(await page.locator('main#main-content .workspace-grid').count(), 'desktop grid leaked').toBe(0)
    expect(await page.evaluate(nestedInteractive), 'nested tap targets').toBe(0)

    const targets = await page.evaluate(probeTargets, MIN_TARGET)
    expect(targets, `sub-44px: ${JSON.stringify(targets.slice(0, 4))}`).toHaveLength(0)

    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk), 'iOS zoom risk').toHaveLength(0)
  })

  test('add-lead sheet is vertical, in-bounds, and keyboard-safe', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoLeads(page)
    test.skip(!(await isFirstRun(page)), 'QA workspace already has leads')

    await page.getByRole('button', { name: 'הוסף ליד' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'הוסף ליד' })
    await expect(dialog).toBeVisible()

    const box = await dialog.boundingBox()
    const vw = testInfo.project.use.viewport?.width ?? 360
    const vh = testInfo.project.use.viewport?.height ?? 800
    expect(box, 'sheet has no box').toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1)
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1)

    const formClass = await dialog.locator('form[aria-label="הוסף ליד"]').getAttribute('class')
    expect(formClass).toMatch(/flex-col/)
    expect(await dialog.locator('form .flex.w-full.gap-3').count()).toBe(0)

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    expect(overflow.elements.filter((e) => !e.scrollableAncestor)).toHaveLength(0)

    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk), 'iOS zoom risk on add-lead fields').toHaveLength(0)
  })

  test('import sheet accepts excel/csv and has no table', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoLeads(page)
    test.skip(!(await isFirstRun(page)), 'QA workspace already has leads')

    await page.getByRole('button', { name: 'ייבוא לידים' }).click()
    const dialog = page.getByRole('dialog', { name: 'ייבוא לידים' })
    await expect(dialog).toBeVisible()
    const accept = await dialog.locator('input[type="file"]').getAttribute('accept')
    expect(accept).toContain('.xlsx')
    expect(accept).toContain('.xls')
    expect(accept).toContain('.csv')
    expect(await dialog.locator('table').count()).toBe(0)

    const box = await dialog.boundingBox()
    const vw = testInfo.project.use.viewport?.width ?? 360
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1)
  })
})

test.describe('P0-A desktop /leads regression', () => {
  test('desktop entity is unchanged', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'desktop entity only')
    test.skip(testInfo.project.name.startsWith('tablet-'), 'covered by the desktop projects')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    expect(await page.locator('[data-mobile-workspace]').count(), 'mobile shell leaked into desktop').toBe(0)
    expect(await page.locator('nav a[href="/m"]').count(), 'mobile tab bar leaked').toBe(0)
    expect(await page.getByRole('button', { name: 'ייבוא לידים' }).count(), 'mobile import CTA on desktop').toBe(0)

    const hasDesktopFirstRun = (await page.getByRole('heading', { name: /בוא נכניס את הלידים|אין עדיין לידים/ }).count()) > 0
    const hasTable = (await page.locator('table').count()) > 0
    expect(hasDesktopFirstRun || hasTable, 'desktop /leads lost both first-run and table').toBe(true)

    if (hasDesktopFirstRun) {
      expect(await page.getByRole('heading', { name: 'בואו נתחיל' }).count()).toBe(0)
      expect(await page.locator('.workspace-grid').count()).toBeGreaterThan(0)
    }
  })
})
