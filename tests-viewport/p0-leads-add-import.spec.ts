import { test, expect, type Page } from '@playwright/test'
import { probeOverflow, probeTargets, probeInputs } from './probes'

/**
 * Populated mobile Leads — header + opens add / import.
 * Empty-workspace first-run stays on the existing P0-A specs.
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
      secure: url.protocol === 'https:',
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

async function gotoLeads(page: Page) {
  await page.goto('/leads', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav[aria-label="ניווט ראשי"], table, [class*="workspace-grid"]', { timeout: 60_000 })
  await page.waitForTimeout(600)
}

async function isPopulatedPhone(page: Page) {
  return (await page.getByTestId('leads-add-action').count()) > 0
}

test.describe('populated mobile Leads add/import', () => {
  test('header + opens add and import sheets; layout stays in-bounds', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoLeads(page)
    test.skip(!(await isPopulatedPhone(page)), 'empty workspace — covered by P0-A first-run')

    const add = page.getByTestId('leads-add-action')
    await expect(add).toBeVisible()
    const addBox = await add.boundingBox()
    expect(addBox, '+ missing box').toBeTruthy()
    expect(Math.min(addBox!.width, addBox!.height)).toBeGreaterThanOrEqual(MIN_TARGET - 0.5)

    expect(await page.locator('main#main-content table').count()).toBe(0)
    expect(await page.locator('main#main-content .workspace-grid').count()).toBe(0)
    expect(await page.evaluate(nestedInteractive)).toBe(0)

    await add.click()
    const chooser = page.getByRole('dialog', { name: 'הוספת ליד' })
    await expect(chooser).toBeVisible()
    await page.waitForTimeout(300)
    const vw = testInfo.project.use.viewport?.width ?? 360
    const vh = testInfo.project.use.viewport?.height ?? 800
    const chooserBox = await chooser.boundingBox()
    expect(chooserBox!.x).toBeGreaterThanOrEqual(-1)
    expect(chooserBox!.x + chooserBox!.width).toBeLessThanOrEqual(vw + 1)
    expect(chooserBox!.y).toBeGreaterThanOrEqual(-1)
    const chooserStyle = await chooser.evaluate((el) => getComputedStyle(el).maxHeight)
    expect(chooserStyle).toMatch(/dvh|px/)
    expect(chooserBox!.height).toBeLessThanOrEqual(vh)

    await chooser.getByRole('button', { name: 'הוסף ליד' }).click()
    const form = page.getByRole('dialog', { name: 'הוסף ליד' })
    await expect(form).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'הוספת ליד' })).toHaveCount(0)
    const formClass = await form.locator('form[aria-label="הוסף ליד"]').getAttribute('class')
    expect(formClass).toMatch(/flex-col/)
    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk), 'iOS zoom risk on add-lead fields').toHaveLength(0)

    await form.getByRole('button', { name: 'סגירה' }).click()
    await expect(form).toHaveCount(0)

    await add.click()
    await page.getByRole('dialog', { name: 'הוספת ליד' }).getByRole('button', { name: 'ייבוא לידים' }).click()
    const importSheet = page.getByRole('dialog', { name: 'ייבוא לידים' })
    await expect(importSheet).toBeVisible()
    const accept = await importSheet.locator('input[type="file"]').getAttribute('accept')
    expect(accept).toContain('.xlsx')
    expect(accept).toContain('.xls')
    expect(accept).toContain('.csv')
    expect(await importSheet.locator('table').count()).toBe(0)

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    expect(overflow.elements.filter((e) => !e.scrollableAncestor)).toHaveLength(0)
    const targets = await page.evaluate(probeTargets, MIN_TARGET)
    expect(targets, `sub-44px: ${JSON.stringify(targets.slice(0, 4))}`).toHaveLength(0)
  })

  test('empty workspace still uses first-run CTAs, not the populated +', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoLeads(page)
    test.skip(await isPopulatedPhone(page), 'workspace already has leads')
    await expect(page.getByRole('heading', { name: /בואו נתחיל|אין עדיין לידים/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'הוסף ליד' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ייבוא לידים' })).toBeVisible()
    await expect(page.getByTestId('leads-add-action')).toHaveCount(0)
  })

  test('More no longer says Excel import is desktop-only', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await page.goto('/m', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#more-desktop', { timeout: 60_000 })
    await expect(page.getByText('חשבוניות, דוחות ואוטומציות זמינים בגרסת המחשב.')).toBeVisible()
    expect(await page.getByText(/ייבוא מאקסל/).count()).toBe(0)
  })
})

test.describe('desktop regression — no mobile add chrome', () => {
  test('desktop /leads has no mobile + and keeps the table or first-run', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'desktop entity only')
    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)
    expect(await page.getByTestId('leads-add-action').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'ייבוא לידים' }).count()).toBe(0)
    expect(await page.getByRole('heading', { name: 'בואו נתחיל' }).count()).toBe(0)

    const hasDesktopFirstRun =
      (await page.getByRole('heading', { name: /בוא נכניס את הלידים|אין עדיין לידים/ }).count()) > 0
    const hasTable = (await page.locator('table').count()) > 0
    expect(hasDesktopFirstRun || hasTable).toBe(true)
  })
})
