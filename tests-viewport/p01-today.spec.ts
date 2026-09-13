import { test, expect, type Page } from '@playwright/test'
import { probeOverflow, probeTargets, probeInputs, probeSafeArea, probeSticky } from './probes'

/**
 * P0-1 — MOBILE TODAY, ASSERTED.
 *
 * The defect this locks out: the Today row put a `tel:` anchor into
 * `MobileListRow`'s `trailing` slot, which renders INSIDE the row's own
 * `<Link>`. Measured before the fix, every populated Today list reported two
 * nested `<a>` pairs at all four phone widths — invalid markup that the parser
 * repairs by closing the outer anchor early, so part of the row silently stops
 * being the link it looks like. The row also offered Call only, on a product
 * whose primary channel is WhatsApp.
 *
 * Desktop Today is NOT exercised for layout here beyond proving the mobile
 * entity never reaches it: P0-1 changed only files under `modules/today/mobile`,
 * which `DashboardPage` imports solely inside its `if (mobile)` branch.
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

async function gotoToday(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })
  await page.waitForTimeout(600)
}

/** `<a>`/`<button>` whose nearest interactive ancestor is another one. */
function nestedInteractive() {
  return Array.from(document.querySelectorAll('a, button'))
    .filter((el) => {
      const outer = el.parentElement?.closest('a, button')
      return outer != null && outer !== el
    })
    .map((el) => ({
      inner: `${el.tagName}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}`,
      outer: (el.parentElement?.closest('a, button') as HTMLElement)?.getAttribute('href') || '',
    }))
}

test.describe('P0-1 mobile Today', () => {
  test('no nested interactive elements anywhere on the screen', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoToday(page)

    const nested = await page.evaluate(nestedInteractive)
    expect(nested, `nested tap targets: ${JSON.stringify(nested)}`).toHaveLength(0)
  })

  test('every lead offers BOTH WhatsApp and Call, at 44px or more', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoToday(page)

    const actions = await page.evaluate(() => {
      const main = document.querySelector('main#main-content')
      const out: { name: string; tag: string; href: string; w: number; h: number }[] = []
      for (const el of Array.from(main?.querySelectorAll('a, button') || [])) {
        const label = el.getAttribute('aria-label') || ''
        if (!/וואטסאפ|התקשר/.test(label)) continue
        const r = el.getBoundingClientRect()
        out.push({
          name: label,
          tag: el.tagName,
          href: el.getAttribute('href') || '',
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      }
      return out
    })

    const wa = actions.filter((a) => a.name.startsWith('וואטסאפ'))
    const call = actions.filter((a) => a.name.startsWith('התקשר'))

    expect(wa.length, 'no WhatsApp action rendered on Today').toBeGreaterThan(0)
    expect(call.length, 'no Call action rendered on Today').toBeGreaterThan(0)

    /**
     * ONE CONTACT DOCTRINE. The WhatsApp control resolves by workspace state, so
     * its ELEMENT is not fixed and asserting a shape here would pin the wrong
     * thing:
     *
     *   WhatsApp connected → a BUTTON that opens the in-app conversation
     *   not connected      → an ANCHOR handing off to wa.me with the lead's number
     *
     * What must hold in BOTH states is that the control is real and leads
     * somewhere usable — never a dead button, never a malformed link. That is
     * what this asserts. The per-state component contract is pinned as a unit
     * test in __tests__/leads/whatsappAction.test.tsx (NF-1, NF-6, NF-8).
     */
    for (const a of wa) {
      if (a.tag === 'A') {
        expect(a.href, `WhatsApp anchor href was "${a.href}"`).toMatch(/^https:\/\/wa\.me\/\d{9,15}$/)
      } else {
        expect(a.tag, `WhatsApp rendered as ${a.tag}`).toBe('BUTTON')
        expect(a.href).toBe('')
      }
    }
    // Call stays a real tel: navigation, owned by the OS dialler.
    for (const a of call) expect(a.href.startsWith('tel:'), `Call href was "${a.href}"`).toBe(true)

    for (const a of actions) {
      expect(Math.min(a.w, a.h), `"${a.name}" is ${a.w}x${a.h}`).toBeGreaterThanOrEqual(MIN_TARGET)
    }

    // A `wa.me` anchor is now a legitimate outcome — the fallback for a workspace
    // with no WhatsApp connected. What must never happen is a MALFORMED one, so
    // every such anchor is checked rather than counted.
    for (const href of await page.locator('a[href*="wa.me"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href') ?? ''),
    )) {
      expect(href, `malformed wa.me href "${href}"`).toMatch(/^https:\/\/wa\.me\/\d{9,15}$/)
    }
  })

  test('WhatsApp and Call hit areas never overlap', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoToday(page)

    const boxes = await page.evaluate(() => {
      const main = document.querySelector('main#main-content')
      return Array.from(main?.querySelectorAll('a, button') || [])
        .filter((el) => /וואטסאפ|התקשר/.test(el.getAttribute('aria-label') || ''))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { name: el.getAttribute('aria-label')!, x: r.left, y: r.top, w: r.width, h: r.height }
        })
    })

    const collisions: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        if (overlap) collisions.push(`${a.name} ∩ ${b.name}`)
      }
    }
    expect(collisions, `overlapping contact targets: ${JSON.stringify(collisions)}`).toHaveLength(0)
  })

  test('pressed states are present on the row link and the contact controls', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoToday(page)

    const pressed = await page.evaluate(() => {
      const main = document.querySelector('main#main-content')
      const rowLinks = Array.from(main?.querySelectorAll('a[href^="/clients/"], a[href^="/inbox"]') || [])
      const contact = Array.from(main?.querySelectorAll('a, button') || []).filter((el) =>
        /וואטסאפ|התקשר/.test(el.getAttribute('aria-label') || ''),
      )
      return {
        rowLinksWithPress: rowLinks.filter((e) => e.classList.contains('press')).length,
        rowLinks: rowLinks.length,
        contactWithPress: contact.filter((e) => e.classList.contains('press')).length,
        contact: contact.length,
      }
    })

    expect(pressed.contact).toBeGreaterThan(0)
    expect(pressed.contactWithPress, 'contact controls missing `press`').toBe(pressed.contact)
    expect(pressed.rowLinksWithPress, 'row links missing `press`').toBeGreaterThan(0)
  })

  test('layout is clean: no overflow, no table, no desktop grid, no zoom, safe-area paid once', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoToday(page)

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    expect(overflow.elements, `overflow: ${JSON.stringify(overflow.elements.slice(0, 3))}`).toHaveLength(0)

    const targets = await page.evaluate(probeTargets, MIN_TARGET)
    const undersized = targets.filter((t) => t.minSide < MIN_TARGET)
    expect(undersized, `sub-44px: ${JSON.stringify(undersized.slice(0, 4))}`).toHaveLength(0)

    const inputs = await page.evaluate(probeInputs)
    expect(inputs.filter((i) => i.zoomRisk), 'iOS zoom risk').toHaveLength(0)

    const safe = await page.evaluate(probeSafeArea)
    expect(safe.consumers.length, 'nothing pays the safe-area inset').toBeGreaterThan(0)
    expect(safe.nestedPairs, `double-paid safe area: ${JSON.stringify(safe.nestedPairs)}`).toHaveLength(0)

    expect(await page.locator('main#main-content table').count(), 'desktop table in the phone entity').toBe(0)
    expect(
      await page.locator('main#main-content .workspace-grid').count(),
      'desktop grid in the phone entity',
    ).toBe(0)

    /**
     * NO STICKY OVERLAP — measured AFTER scrolling to the end.
     *
     * The first version of this check measured the last row where it happened to
     * sit on load. That passed on v2's short list and failed on v1, whose
     * "ממתינים" section runs to 43 rows: the final row was legitimately 2944px
     * down a scrolling region, which is not overlap. Overlap only means anything
     * once the list is scrolled as far as it goes — at that point the last row
     * must sit fully above the tab bar.
     */
    const sticky = await page.evaluate(probeSticky)
    expect(sticky.find((s) => s.selector.includes('nav')), 'tab bar not found as sticky').toBeTruthy()

    await page.evaluate(() => {
      const scroller = document.querySelector('main#main-content')
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
    await page.waitForTimeout(400)

    // Re-measure both after the scroll settles.
    const geom = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll('main#main-content a[href^="/clients/"], main#main-content a[href^="/inbox"]'),
      )
      const last = rows[rows.length - 1]
      const nav = document.querySelector('nav[aria-label="ניווט ראשי"]')
      return {
        lastRowBottom: last ? last.getBoundingClientRect().bottom : 0,
        barTop: nav ? nav.getBoundingClientRect().top : 0,
      }
    })
    if (geom.lastRowBottom > 0 && geom.barTop > 0) {
      expect(geom.lastRowBottom, 'the last Today row is covered by the tab bar').toBeLessThanOrEqual(geom.barTop + 1)
    }
  })

  test('back navigation and refresh both return a working Today', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await gotoToday(page)

    const countActions = () =>
      page.evaluate(
        () =>
          Array.from(document.querySelectorAll('main#main-content a, main#main-content button')).filter((el) =>
            /וואטסאפ|התקשר/.test(el.getAttribute('aria-label') || ''),
          ).length,
      )

    const before = await countActions()
    expect(before).toBeGreaterThan(0)

    /**
     * Waiting on the URL alone is not enough. During the App Router transition
     * both trees are briefly in the document, so a count taken then picks up the
     * לידים list's contact actions too (measured: 66 instead of 6 — thirty lead
     * rows plus Today's). `#mobile-today-hero` belongs only to the mobile Today
     * hero, so settling on it means the Today tree is the one mounted.
     */
    const settleOnToday = async () => {
      await page.waitForURL('**/dashboard**', { timeout: 60_000 })
      await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })
      await page.waitForSelector('#mobile-today-hero', { state: 'attached', timeout: 60_000 })
      await expect
        .poll(async () => page.locator('main#main-content a[href^="/leads"]').count(), { timeout: 15_000 })
        .toBe(0)
    }

    /**
     * Polled, not asserted on first paint. The page is PPR'd: the prerendered
     * shell (including `#mobile-today-hero`) can be in the document before the
     * streamed content that carries the contact cluster, so a `reload` measured
     * immediately reports 0 actions on a page that is merely still arriving.
     * Polling asserts the settled state and still fails if they never appear.
     */
    const expectSettledActions = async (label: string) => {
      await settleOnToday()
      await expect.poll(countActions, { timeout: 20_000, message: label }).toBe(before)
      expect(await page.evaluate(nestedInteractive), `nesting reappeared ${label}`).toHaveLength(0)
    }

    await page.click('nav[aria-label="ניווט ראשי"] a[href="/leads"]')
    await page.waitForURL('**/leads**', { timeout: 60_000 })
    await page.goBack()
    await expectSettledActions('after back navigation')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectSettledActions('after refresh')
  })
})

test.describe('P0-1 desktop regression', () => {
  test('the phone Today never reaches the desktop entity', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'desktop entity only')
    test.skip(testInfo.project.name.startsWith('tablet-'), 'covered by the desktop projects')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('a[href="/inbox"]', { state: 'attached', timeout: 60_000 })

    expect(await page.locator('[data-mobile-workspace]').count(), 'mobile shell leaked into desktop').toBe(0)
    expect(await page.locator('nav a[href="/m"]').count(), 'mobile tab bar leaked into desktop').toBe(0)

    // The mobile Today components render a hero section with this exact id; it
    // must not exist in the desktop tree.
    expect(await page.locator('#mobile-today-hero').count(), 'mobile Today hero leaked into desktop').toBe(0)

    // Desktop keeps its own workspace grid.
    expect(await page.locator('.workspace-grid').count(), 'desktop workspace grid missing').toBeGreaterThan(0)
  })
})
