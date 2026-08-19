import { test, expect, type Page, type Locator } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import pg from 'pg'
import { probeOverflow, probeTargets, probeInputs } from './probes'

loadEnv({ path: '.env.local' })

/**
 * P0-A FINAL empty-workspace real-browser smoke.
 *
 * Layout tests are non-mutating. Submit / duplicate seed run only when
 * P0A_SMOKE_MUTATE=1 and only on phone-360x800, so later viewports still see
 * a truly empty workspace.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const XLSX_PATH = process.env.P0A_XLSX_PATH || ''
const MUTATE = process.env.P0A_SMOKE_MUTATE === '1'
const AGENCY_ID = Number(process.env.P0A_EMPTY_AGENCY_ID || '41')
const USER_ID = Number(process.env.P0A_EMPTY_USER_ID || '183')
const DUP_PHONE = '0501112233'
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
const isPhone360 = (name: string) => name === 'phone-360x800'

function nestedInteractive() {
  return Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  }).length
}

function primaryTooSmall(minSize: number) {
  const names = ['הוסף ליד', 'ייבוא לידים', 'בחירת קובץ', 'ייבא']
  const out: { name: string; minSide: number }[] = []
  for (const el of Array.from(document.querySelectorAll('button, [role=button]'))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()
    if (!names.some((n) => name.includes(n))) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const minSide = Math.min(r.width, r.height)
    if (minSide + 0.5 < minSize) out.push({ name: name.slice(0, 40), minSide: Math.round(minSide * 10) / 10 })
  }
  return out
}

function fieldStack(dialogSel: string) {
  const dialog = document.querySelector(dialogSel)
  if (!dialog) return { stacked: false, fonts: [] as number[] }
  const inputs = Array.from(dialog.querySelectorAll('form input:not([type=hidden]):not([type=file])')) as HTMLElement[]
  const tops = inputs.map((el) => el.getBoundingClientRect().top)
  const stacked = tops.length < 2 || tops.every((t, i) => i === 0 || t > tops[i - 1] + 8)
  const fonts = inputs.map((el) => parseFloat(getComputedStyle(el).fontSize))
  return { stacked, fonts, count: inputs.length }
}

async function gotoReady(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 90_000 })
  // Client sheets (BottomSheet/ModalPop) only open after hydration.
  await page.waitForTimeout(800)
}

async function assertNoHandoff(page: Page) {
  const body = await page.locator('main#main-content').innerText()
  expect(body).not.toMatch(/זמינים כרגע במחשב|זמינים במחשב|המשך במחשב|continue on computer/i)
}

async function assertEmptyFirstRun(page: Page) {
  await expect(page.locator('[data-mobile-workspace]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: /בואו נתחיל|אין עדיין לידים/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'הוסף ליד' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ייבוא לידים' })).toBeVisible()
  expect(await page.locator('main#main-content table').count()).toBe(0)
  expect(await page.locator('main#main-content .workspace-grid').count()).toBe(0)
  await assertNoHandoff(page)
}

async function measureSheet(dialog: Locator, vw: number, vh: number) {
  await dialog.page().waitForTimeout(250)
  const box = await dialog.boundingBox()
  expect(box, 'sheet has no box').toBeTruthy()
  const metrics = await dialog.evaluate((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
      overflowX: cs.overflowX,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right },
    }
  })
  return { box: box!, vw, vh, metrics }
}

async function assertSheetWidth(measured: Awaited<ReturnType<typeof measureSheet>>) {
  const { box, vw, metrics } = measured
  expect(box.x).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1)
  expect(metrics.rect.right).toBeLessThanOrEqual(vw + 1)
}

async function assertPhoneChrome(page: Page) {
  const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
  expect(overflow.elements.filter((e) => !e.scrollableAncestor), `overflow: ${JSON.stringify(overflow.elements.slice(0, 3))}`).toHaveLength(0)
  expect(await page.evaluate(nestedInteractive), 'nested tap targets').toBe(0)
  const targets = await page.evaluate(probeTargets, MIN_TARGET)
  const primary = await page.evaluate(primaryTooSmall, MIN_TARGET)
  expect(primary, `sub-44px primary: ${JSON.stringify(primary)}`).toHaveLength(0)
  const inputs = await page.evaluate(probeInputs)
  expect(inputs.filter((i) => i.zoomRisk), 'iOS zoom risk').toHaveLength(0)
  return { overflow, targets, inputs }
}

async function db() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for mutate checks')
  return new pg.Pool({ connectionString: url })
}

test.describe('P0-A empty workspace — phone layout', () => {
  test('TEST 1 empty /leads first-run', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoReady(page, '/leads')
    await assertEmptyFirstRun(page)
    await assertPhoneChrome(page)
  })

  test('TEST 2 add-lead sheet geometry (no submit)', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoReady(page, '/leads')
    await page.getByRole('button', { name: 'הוסף ליד' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'הוסף ליד' })
    await expect(dialog).toBeVisible()

    const vw = testInfo.project.use.viewport?.width ?? 360
    const vh = testInfo.project.use.viewport?.height ?? 800
    const geom = await measureSheet(dialog, vw, vh)
    test.info().annotations.push({ type: 'add-sheet', description: JSON.stringify(geom.metrics) })
    console.log('ADD_SHEET', testInfo.project.name, JSON.stringify(geom.metrics), 'boxH', geom.box.height, 'vh', vh)
    await assertSheetWidth(geom)

    const formClass = await dialog.locator('form[aria-label="הוסף ליד"]').getAttribute('class')
    expect(formClass).toMatch(/flex-col/)
    expect(await dialog.locator('form .flex.w-full.gap-3').count()).toBe(0)

    const stack = await page.evaluate(fieldStack, '[role="dialog"]')
    expect(stack.stacked, 'fields are not vertically stacked').toBe(true)
    expect(stack.fonts.every((n) => n >= 16), `font sizes ${JSON.stringify(stack.fonts)}`).toBe(true)

    const email = dialog.getByRole('textbox', { name: 'מייל' })
    await email.click()
    await email.fill('p0a-smoke@example.com')
    const submit = dialog.locator('form[aria-label="הוסף ליד"]').getByRole('button', { name: 'הוסף ליד' })
    await submit.scrollIntoViewIfNeeded()
    const submitBox = await submit.boundingBox()
    const dialogBox = await dialog.boundingBox()
    expect(submitBox, 'CTA missing').toBeTruthy()
    expect(submitBox!.height).toBeGreaterThanOrEqual(44)
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) + 2)

    const visual = await page.evaluate(() => ({
      innerHeight: window.innerHeight,
      visualHeight: window.visualViewport?.height ?? null,
      keyboardLikely: window.visualViewport != null && window.visualViewport.height < window.innerHeight - 80,
    }))
    test.info().annotations.push({
      type: 'keyboard',
      description: `Chromium visualViewport=${visual.visualHeight} inner=${visual.innerHeight} keyboardLikely=${visual.keyboardLikely}`,
    })

    await assertPhoneChrome(page)
    const heightOver = geom.box.y + geom.box.height - (vh + 1)
    expect(
      heightOver,
      `add sheet taller than viewport by ${heightOver}px (maxHeight=${geom.metrics.maxHeight} client=${geom.metrics.clientHeight} scroll=${geom.metrics.scrollHeight})`,
    ).toBeLessThanOrEqual(0)
    await dialog.getByRole('button', { name: 'סגירה' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('TEST 5 import picker + excel preview (no confirm write)', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    test.skip(!XLSX_PATH, 'P0A_XLSX_PATH fixture missing')
    await gotoReady(page, '/leads')
    await page.getByRole('button', { name: 'ייבוא לידים' }).click()
    const dialog = page.getByRole('dialog', { name: 'ייבוא לידים' })
    await expect(dialog).toBeVisible()

    const vw = testInfo.project.use.viewport?.width ?? 360
    const vh = testInfo.project.use.viewport?.height ?? 800
    const geom = await measureSheet(dialog, vw, vh)
    test.info().annotations.push({ type: 'import-sheet', description: JSON.stringify(geom.metrics) })
    console.log('IMPORT_SHEET', testInfo.project.name, JSON.stringify(geom.metrics), 'boxH', geom.box.height, 'vh', vh)
    await assertSheetWidth(geom)

    const accept = await dialog.locator('input[type="file"]').getAttribute('accept')
    expect(accept).toContain('.xlsx')
    expect(accept).toContain('.xls')
    expect(accept).toContain('.csv')
    expect(await dialog.locator('table').count()).toBe(0)
    expect(await dialog.locator('.grid.grid-cols-2').count()).toBe(0)

    const chooserP = page.waitForEvent('filechooser', { timeout: 8_000 })
    await dialog.getByRole('button', { name: 'בחירת קובץ', exact: true }).click()
    const chooser = await chooserP
    expect(chooser, 'native file picker did not open').toBeTruthy()
    await chooser.setFiles(XLSX_PATH)

    const loading = dialog.getByRole('button', { name: 'מעבד...' })
    const summary = dialog.getByText(/מצאנו \d+ לידים/)
    await Promise.race([
      loading.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => null),
      summary.waitFor({ state: 'visible', timeout: 8_000 }),
    ])
    await expect(summary).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/\d+ תקינים/)).toBeVisible()
    await expect(dialog.getByText(/\d+ דורשים בדיקה/)).toBeVisible()
    expect(await dialog.locator('table').count()).toBe(0)
    expect(await dialog.locator('.grid.grid-cols-2').count()).toBe(0)

    const importCta = dialog.getByRole('button', { name: /ייבא \d+ לידים|אין לידים לייבוא/ })
    await expect(importCta).toBeVisible()
    const ctaBox = await importCta.boundingBox()
    expect(ctaBox!.height).toBeGreaterThanOrEqual(44)

    const geomAfter = await measureSheet(dialog, vw, vh)
    test.info().annotations.push({ type: 'import-sheet-after', description: JSON.stringify(geomAfter.metrics) })
    await assertSheetWidth(geomAfter)
    await assertPhoneChrome(page)
    const heightOver = geomAfter.box.y + geomAfter.box.height - (vh + 1)
    expect(
      heightOver,
      `import sheet taller than viewport by ${heightOver}px (maxHeight=${geomAfter.metrics.maxHeight} client=${geomAfter.metrics.clientHeight} scroll=${geomAfter.metrics.scrollHeight})`,
    ).toBeLessThanOrEqual(0)
    await dialog.getByRole('button', { name: 'סגירה' }).click()
  })

  test('TEST 6 empty /dashboard matches leads first-run', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoReady(page, '/dashboard')
    expect(page.url()).toMatch(/\/dashboard/)
    await assertEmptyFirstRun(page)
    await assertPhoneChrome(page)
    await page.getByRole('button', { name: 'הוסף ליד' }).first().click()
    await expect(page.getByRole('dialog', { name: 'הוסף ליד' })).toBeVisible()
    await page.getByRole('dialog', { name: 'הוסף ליד' }).getByRole('button', { name: 'סגירה' }).click()
  })
})

test.describe.serial('P0-A empty workspace — real writes', () => {
  test('WRITE add-lead submit persists via upsertLead', async ({ page }, testInfo) => {
    test.skip(!MUTATE, 'layout pass only — writes are a second invocation')
    test.skip(!isPhone360(testInfo.project.name), 'writes only on 360x800')

    const pool = await db()
    try {
      await pool.query('delete from clients where "agencyId"=$1', [AGENCY_ID])
      const before = await pool.query('select count(*)::int as n from clients where "agencyId"=$1', [AGENCY_ID])
      expect(before.rows[0].n).toBe(0)

      const posts: { url: string; nextAction: boolean; status?: number }[] = []
      page.on('response', (res) => {
        const req = res.request()
        if (req.method() === 'POST' && req.url().includes('/leads')) {
          posts.push({ url: req.url(), nextAction: Boolean(req.headers()['next-action']), status: res.status() })
        }
      })

      await gotoReady(page, '/leads')
      await page.getByRole('button', { name: 'הוסף ליד' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'הוסף ליד' })
      await expect(dialog).toBeVisible()

      await dialog.getByRole('textbox', { name: 'שם פרטי' }).fill('P0A-Smoke')
      await dialog.getByRole('textbox', { name: 'שם משפחה' }).fill('ריק')
      await dialog.getByRole('textbox', { name: 'טלפון נייד' }).fill('0509998877')
      const submit = dialog.locator('form[aria-label="הוסף ליד"]').getByRole('button', { name: 'הוסף ליד' })

      await Promise.all([
        page.waitForURL(/\/clients\/\d+\/summary\?firstLead=1/, { timeout: 45_000, waitUntil: 'domcontentloaded' }),
        submit.click(),
      ])

      expect(await page.getByText('שגיאה בשמירת לקוח').count()).toBe(0)
      expect(posts.some((p) => p.nextAction && p.status === 200), `POST /leads: ${JSON.stringify(posts)}`).toBe(true)

      const id = Number(page.url().match(/\/clients\/(\d+)\//)?.[1])
      expect(Number.isInteger(id) && id > 0).toBe(true)
      console.log('CREATED_LEAD_ID', id)

      const created = await pool.query(
        'select id, "firstName", "lastName", phone, lead, "agencyId", "createOrigin" from clients where id=$1',
        [id],
      )
      expect(created.rows[0].firstName).toBe('P0A-Smoke')
      expect(created.rows[0].lastName).toBe('ריק')
      expect(created.rows[0].agencyId).toBe(AGENCY_ID)
      expect(created.rows[0].lead).toBe(true)
      expect(created.rows[0].createOrigin).toBe('manual')

      await expect(page.locator('[data-mobile-workspace]')).toHaveCount(1)
      expect(await page.locator('main#main-content table').count()).toBe(0)

      await gotoReady(page, '/leads')
      expect(await page.getByRole('heading', { name: 'בואו נתחיל' }).count()).toBe(0)
      await expect(page.getByText('P0A-Smoke').first()).toBeVisible()
      await assertPhoneChrome(page)
    } finally {
      await pool.end()
    }
  })

  test('WRITE import confirm persists via addLeads', async ({ page }, testInfo) => {
    test.skip(!MUTATE, 'layout pass only — writes are a second invocation')
    test.skip(!isPhone360(testInfo.project.name), 'writes only on 360x800')
    test.skip(!XLSX_PATH, 'P0A_XLSX_PATH fixture missing')

    const pool = await db()
    try {
      await pool.query('delete from clients where "agencyId"=$1', [AGENCY_ID])
      const before = await pool.query('select count(*)::int as n from clients where "agencyId"=$1', [AGENCY_ID])
      expect(before.rows[0].n).toBe(0)

      await gotoReady(page, '/leads')
      await page.getByRole('button', { name: 'ייבוא לידים' }).click()
      const dialog = page.getByRole('dialog', { name: 'ייבוא לידים' })
      await expect(dialog).toBeVisible()

      const chooserP = page.waitForEvent('filechooser', { timeout: 8_000 })
      await dialog.getByRole('button', { name: 'בחירת קובץ', exact: true }).click()
      await (await chooserP).setFiles(XLSX_PATH)

      await expect(dialog.getByText(/מצאנו \d+ לידים/)).toBeVisible({ timeout: 30_000 })
      await expect(dialog.getByText(/\d+ תקינים/)).toBeVisible()
      const confirm = dialog.getByRole('button', { name: /ייבא \d+ לידים/ })
      await expect(confirm).toBeVisible()
      expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44)

      await confirm.click()
      await expect(dialog).toHaveCount(0, { timeout: 45_000 })
      expect(await page.getByText('createOrigin').count()).toBe(0)

      const imported = await pool.query(
        'select id, "firstName", "lastName", "idNum", "createOrigin", lead from clients where "agencyId"=$1 order by id',
        [AGENCY_ID],
      )
      console.log('IMPORTED_LEADS', JSON.stringify(imported.rows))
      expect(imported.rows.length).toBeGreaterThan(0)
      expect(imported.rows.every((r) => r.createOrigin === 'import')).toBe(true)
      expect(imported.rows.some((r) => r.firstName === 'עמוס')).toBe(true)

      await gotoReady(page, '/leads')
      expect(await page.getByRole('heading', { name: 'בואו נתחיל' }).count()).toBe(0)
      await expect(page.getByText('עמוס').first()).toBeVisible()
      expect(await page.locator('main#main-content table').count()).toBe(0)
      await assertPhoneChrome(page)
    } finally {
      await pool.end()
    }
  })
})

test.describe('P0-A desktop regression', () => {
  test('desktop LeadsFirstRun / ClientForm / UploadClientData unchanged', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'desktop entity only')
    test.skip(testInfo.project.name.startsWith('tablet-'), 'not in this pass')

    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    expect(await page.locator('[data-mobile-workspace]').count()).toBe(0)
    expect(await page.locator('nav a[href="/m"]').count()).toBe(0)
    expect(await page.getByRole('heading', { name: 'בואו נתחיל' }).count()).toBe(0)
    const hasDesktopFirstRun = (await page.getByRole('heading', { name: /בוא נכניס את הלידים|אין עדיין לידים/ }).count()) > 0
    const hasTable = (await page.locator('table').count()) > 0
    expect(hasDesktopFirstRun || hasTable, 'desktop /leads lost both first-run and table').toBe(true)
    expect(await page.getByRole('button', { name: 'ייבוא לידים' }).count()).toBe(0)
    if (!hasDesktopFirstRun) return

    expect(await page.locator('.workspace-grid').count()).toBeGreaterThan(0)

    await page.getByRole('button', { name: /הוסף ליד/ }).click()
    const formDialog = page.getByRole('dialog', { name: 'פרטי ליד' })
    await expect(formDialog).toBeVisible()
    expect(await formDialog.locator('.flex.w-full.gap-3').count()).toBeGreaterThan(0)
    expect(await formDialog.locator('[data-prefix]').count()).toBeGreaterThan(0)
    await formDialog.getByRole('button', { name: 'סגירה' }).click()

    await page.getByRole('button', { name: 'ייבוא מאקסל' }).click()
    const upload = page.getByRole('dialog', { name: 'העלאת לידים' })
    await expect(upload).toBeVisible()
    expect(await upload.locator('.grid.grid-cols-2').count()).toBeGreaterThan(0)
    await expect(upload.getByText(/רק קובץ בפורמט excel/)).toBeVisible()
  })
})
