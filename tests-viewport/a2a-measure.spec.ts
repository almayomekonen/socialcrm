import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  probeOverflow,
  probeTargets,
  probeInputs,
  probeSticky,
  probeSafeArea,
  probeBottomReachability,
  probeStates,
} from './probes'

/**
 * A2a — MEASUREMENT, NOT ASSERTION.
 *
 * This spec drives the REAL authenticated product at the required viewports and
 * records what it finds. It deliberately does not fail on defects: the point of
 * A2a is to produce numbers to decide from, and a red suite that stops at the
 * first violation would hide the other twenty.
 *
 * The only `expect`s here guard the MEASUREMENT ITSELF — that we are logged in
 * and looking at the intended entity. A run that silently measured a login
 * redirect would be worse than no run at all.
 *
 * SESSION. `MOBILE_QA_TOKEN` is a session cookie minted against the local dev
 * database at run time. It is passed by environment and never written to the
 * repo. The committed `tests/test_users` fixture is NOT reused: its user (264)
 * no longer exists in this database, so it silently redirects to
 * `/api/auth/clear`.
 *
 * ENTITY. Which shell renders is decided server-side from the User-Agent
 * (`lib/device.ts`), and the per-viewport UA is set in
 * `playwright.viewport.config.ts`. Phone widths therefore exercise the mobile
 * workspace; 768 and above exercise the desktop entity, which is what a real
 * iPad and a real laptop receive.
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const OUT_DIR = process.env.MOBILE_QA_OUT || path.join(process.cwd(), 'tests-viewport', '.results')

/** Sub-pixel noise from fractional layout is not a defect. */
const OVERFLOW_TOLERANCE = 1
const MIN_TARGET = 44

type Bag = Record<string, unknown>
const results: Bag[] = []

function record(entry: Bag) {
  results.push(entry)
}

test.beforeAll(() => {
  if (!TOKEN) {
    throw new Error(
      'MOBILE_QA_TOKEN is required. Mint one against the local dev DB and export it before running this config.',
    )
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
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

test.afterAll(async ({}, testInfo) => {
  const file = path.join(OUT_DIR, `${testInfo.project.name}.json`)
  fs.writeFileSync(file, JSON.stringify({ project: testInfo.project.name, results }, null, 2))
  // eslint-disable-next-line no-console
  console.log(`\n[A2a] ${testInfo.project.name}: wrote ${results.length} route measurements → ${file}`)
})

/** Navigate and prove we are looking at the product, not an auth bounce. */
async function goto(page: Page, route: string) {
  const res = await page.goto(route, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const url = page.url()
  expect(url, `navigated away from ${route} — session or gate problem`).not.toContain('/auth')
  expect(url, `bounced to auth-clear on ${route} — token rejected`).not.toContain('/api/auth/clear')
  expect(url, `redirected to /activate on ${route}`).not.toContain('/activate')
  return res
}

async function measure(page: Page, route: string, label: string, isPhone: boolean) {
  const [overflow, targets, inputs, sticky, safeArea, states] = await Promise.all([
    page.evaluate(probeOverflow, OVERFLOW_TOLERANCE),
    page.evaluate(probeTargets, MIN_TARGET),
    page.evaluate(probeInputs),
    page.evaluate(probeSticky),
    page.evaluate(probeSafeArea),
    page.evaluate(probeStates),
  ])

  // Only the phone entity has the scrolling shell this probe assumes.
  const bottom = isPhone ? await page.evaluate(probeBottomReachability) : null

  const shell = await page.evaluate(() => ({
    mobileShell: !!document.querySelector('[data-mobile-workspace]'),
    desktopNav: !!document.querySelector('#navPop'),
    tables: document.querySelectorAll('table').length,
    tableInMain: !!document.querySelector('main#main-content table'),
  }))

  record({ route, label, shell, overflow, targets, inputs, sticky, safeArea, states, bottom })
  return { overflow, targets, inputs, sticky, shell }
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const ROUTES: { route: string; label: string }[] = [
  { route: '/dashboard', label: 'Today' },
  { route: '/leads', label: 'Leads list' },
  { route: '/leads?q=%D7%93', label: 'Leads filtered (search)' },
  { route: '/leads?status=new,contacted', label: 'Leads filtered (status)' },
  { route: '/leads?q=zzzznotfound', label: 'Leads filtered-empty' },
  { route: '/clients/1/summary', label: 'Lead detail' },
  { route: '/inbox', label: 'Inbox list' },
  { route: '/notifications', label: 'Notifications' },
  { route: '/m', label: 'More' },
]

test.describe('A2a viewport measurement', () => {
  test('measures every mobile surface', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')

    for (const { route, label } of ROUTES) {
      await goto(page, route)
      const { shell } = await measure(page, route, label, isPhone)

      // Entity sanity: the phone projects must be in the mobile shell and the
      // desktop projects must not be. If this drifts, every other number in the
      // run describes the wrong product.
      if (isPhone) {
        expect(shell.mobileShell, `${route} did not render the mobile shell`).toBe(true)
        expect(shell.desktopNav, `${route} rendered the DESKTOP nav on a phone`).toBe(false)
      } else {
        expect(shell.mobileShell, `${route} rendered the MOBILE shell on desktop/tablet`).toBe(false)
      }
    }
  })

  /* ---------------------------------------------------------------- */

  test('BottomSheet — filter sheet open', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'BottomSheet is a phone surface')

    await goto(page, '/leads')
    await page.getByRole('button', { name: /סינון לפי סטטוס/ }).click()
    await expect(page.getByRole('dialog', { name: 'סינון לפי סטטוס' })).toBeVisible()
    await measure(page, '/leads', 'Leads + BottomSheet open', true)
  })

  test('LeadDetailActions — status / follow-up / outcome sheets', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'phone surface')

    for (const name of ['סטטוס', 'מעקב', 'תוצאה']) {
      await goto(page, '/clients/1/summary')
      const btn = page.getByRole('button', { name, exact: true })
      if ((await btn.count()) === 0) {
        record({ route: '/clients/1/summary', label: `sheet:${name}`, missing: true })
        continue
      }
      await btn.first().click()
      await page.waitForTimeout(350)
      await measure(page, '/clients/1/summary', `Lead detail + ${name} sheet`, true)
    }
  })

  test('ConversationThreadMobile — inbox thread + composer', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'phone surface')

    await goto(page, '/inbox')
    const first = page.locator('a[href*="conversation="]').first()
    if ((await first.count()) === 0) {
      record({ route: '/inbox', label: 'thread', missing: true, note: 'no conversations in local DB' })
      return
    }
    await first.click()
    const navigated = await page
      .waitForURL(/conversation=/, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    if (!navigated) {
      record({ route: '/inbox', label: 'thread', missing: true, note: 'conversation click did not navigate', url: page.url() })
      return
    }
    await page.waitForLoadState('networkidle').catch(() => {})
    await measure(page, page.url().replace(/^https?:\/\/[^/]+/, ''), 'Inbox thread', true)

    // Keyboard proxy: focus the composer and re-measure with a shortened
    // viewport standing in for the on-screen keyboard.
    const composer = page.locator('textarea').first()
    if ((await composer.count()) > 0) {
      await composer.focus()
      const vp = page.viewportSize()!
      await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) })
      await page.waitForTimeout(200)

      const kb = await page.evaluate(() => {
        const ta = document.querySelector('textarea') as HTMLElement | null
        const nav = document.querySelector('nav[aria-label="ניווט ראשי"]') as HTMLElement | null
        if (!ta) return null
        const r = ta.getBoundingClientRect()
        const n = nav ? nav.getBoundingClientRect() : null
        return {
          composerTop: Math.round(r.top),
          composerBottom: Math.round(r.bottom),
          viewportHeight: window.innerHeight,
          composerFullyVisible: r.top >= 0 && r.bottom <= window.innerHeight,
          navTop: n ? Math.round(n.top) : null,
          coveredByNav: n ? r.bottom > n.top : false,
        }
      })
      record({ route: '/inbox', label: 'composer + shortened viewport (keyboard PROXY)', keyboard: kb })
      await page.setViewportSize(vp)
    }
  })

  test('lead search — focus behaviour with a shortened viewport', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'phone surface')

    await goto(page, '/leads')
    const input = page.locator('#lead-search')
    await input.focus()

    const before = await page.evaluate(() => {
      const el = document.getElementById('lead-search')!
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), fontSize: getComputedStyle(el).fontSize }
    })

    const vp = page.viewportSize()!
    await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) })
    await page.waitForTimeout(200)

    const after = await page.evaluate(() => {
      const el = document.getElementById('lead-search')!
      const r = el.getBoundingClientRect()
      const nav = document.querySelector('nav[aria-label="ניווט ראשי"]')
      const n = nav ? nav.getBoundingClientRect() : null
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        visible: r.top >= 0 && r.bottom <= window.innerHeight,
        coveredByNav: n ? r.bottom > n.top : false,
      }
    })

    record({ route: '/leads', label: 'search focus (keyboard PROXY)', keyboard: { before, after } })
    await page.setViewportSize(vp)
  })

  test('scroll restoration — leads list and inbox', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'phone surface')

    // ---- /leads → lead detail → back ----
    await goto(page, '/leads')
    const scrollTo = await page.evaluate(() => {
      const m = document.querySelector('main#main-content') as HTMLElement
      m.scrollTop = Math.min(600, m.scrollHeight)
      return { requested: m.scrollTop, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight }
    })
    await page.waitForTimeout(150)
    const beforeLeads = await page.evaluate(
      () => (document.querySelector('main#main-content') as HTMLElement).scrollTop,
    )

    const cards = page.locator('a[href*="/summary"]')
    const cardCount = await cards.count()
    let leadsRestore: Bag = { skipped: 'no lead card found', cardCount }

    /**
     * Click a card that is ALREADY on screen at the scrolled position.
     *
     * Playwright's `click()` calls scrollIntoViewIfNeeded first, so clicking the
     * list's first card scrolls the container back to the top BEFORE the click —
     * the save then correctly records 0 and the run reports a restoration
     * failure that is purely an artefact of the test. This picks a card inside
     * the current viewport so the scroller is never moved.
     */
    const inViewIndex = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/summary"]'))
      return links.findIndex((a) => {
        const r = a.getBoundingClientRect()
        return r.top > 150 && r.bottom < window.innerHeight - 120
      })
    })

    if (cardCount > 0 && inViewIndex >= 0) {
      // Navigation must be CONFIRMED before anything downstream is measured. The
      // first cut asserted nothing here, the client-side push had not landed by
      // the time the URL was read, and the run produced a "scroll not restored"
      // finding that was purely an artefact of this test.
      await cards.nth(inViewIndex).click({ position: { x: 5, y: 5 } })
      const navigated = await page
        .waitForURL(/\/clients\/\d+\/summary/, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false)

      if (!navigated) {
        leadsRestore = { inconclusive: 'lead card click did not navigate', url: page.url(), cardCount }
      } else {
        const onDetail = page.url()
        await page.goBack()
        const backOk = await page
          .waitForURL(/\/leads(\?|$)/, { timeout: 30_000 })
          .then(() => true)
          .catch(() => false)
        // The scroller belongs to the shell; wait for it rather than sampling a
        // page that has not finished rendering.
        await page.locator('main#main-content').waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
        await page.waitForTimeout(600)

        const afterLeads = await page.evaluate(() => {
          const m = document.querySelector('main#main-content') as HTMLElement | null
          return m ? m.scrollTop : -1
        })
        leadsRestore = {
          scrollTo,
          before: beforeLeads,
          onDetail,
          backOk,
          after: afterLeads,
          restored: afterLeads >= beforeLeads - 8,
          scrollerFound: afterLeads !== -1,
        }
      }
    }
    record({ route: '/leads', label: 'scroll restoration', scroll: leadsRestore })

    /**
     * The negative case, and the one that matters most for trust: changing the
     * filter must NOT inherit the previous list's offset. `/leads?status=new`
     * and `/leads?status=contacted` are different keys, so the second has no
     * saved entry and must start at the top.
     */
    await goto(page, '/leads?status=new')
    await page.evaluate(() => {
      const m = document.querySelector('main#main-content') as HTMLElement
      m.scrollTop = 600
    })
    await page.waitForTimeout(200)
    await goto(page, '/leads?status=contacted')
    await page.waitForTimeout(600)
    const afterFilter = await page.evaluate(() => {
      const m = document.querySelector('main#main-content') as HTMLElement | null
      return m ? m.scrollTop : -1
    })
    record({
      route: '/leads?status=contacted',
      label: 'filter change must NOT restore',
      scroll: { after: afterFilter, correctlyAtTop: afterFilter === 0 },
    })

    // ---- /inbox → conversation → back ----
    await goto(page, '/inbox')
    const beforeInbox = await page.evaluate(() => {
      const m = document.querySelector('main#main-content') as HTMLElement
      m.scrollTop = Math.min(400, m.scrollHeight)
      return m.scrollTop
    })
    const conv = page.locator('a[href*="conversation="]')
    const convCount = await conv.count()
    const scrollable = await page.evaluate(() => {
      const m = document.querySelector('main#main-content') as HTMLElement | null
      return m ? m.scrollHeight - m.clientHeight : 0
    })

    let inboxRestore: Bag = { skipped: 'no conversation found', convCount }
    if (convCount > 0) {
      await conv.first().click()
      const navigated = await page
        .waitForURL(/conversation=/, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false)

      if (!navigated) {
        inboxRestore = { inconclusive: 'conversation click did not navigate', url: page.url(), convCount }
      } else {
        const onThread = page.url()
        await page.goBack()
        await page.waitForURL(/\/inbox(\?|$)/, { timeout: 30_000 }).catch(() => {})
        await page.locator('main#main-content').waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
        await page.waitForTimeout(600)
        const afterInbox = await page.evaluate(() => {
          const m = document.querySelector('main#main-content') as HTMLElement | null
          return m ? m.scrollTop : -1
        })
        inboxRestore = {
          convCount,
          // With one conversation the list does not scroll, so "restored" would
          // be vacuously true. Recorded so the report can say NOT MEASURABLE
          // rather than claim a pass it did not earn.
          scrollableBy: scrollable,
          measurable: scrollable > 50,
          before: beforeInbox,
          onThread,
          after: afterInbox,
          restored: afterInbox >= beforeInbox - 8,
        }
      }
    }
    record({ route: '/inbox', label: 'scroll restoration', scroll: inboxRestore })
  })

  /**
   * The route-level `loading.tsx` boundary, measured while it is actually on
   * screen.
   *
   * The A2a report recorded "0 skeletons" because it sampled SETTLED pages. The
   * boundaries do exist — the question this answers is what shape they are on a
   * phone. Delaying the RSC payload for a client-side navigation holds the
   * fallback open deterministically, which is the only way to measure it.
   */
  test('loading boundaries — shape on a phone', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'phone surface')

    /**
     * DIAGNOSTIC, NOT A GATE. This probe holds an RSC response open to catch a
     * `loading.tsx` fallback mid-flight, which makes it inherently timing
     * sensitive — under a loaded dev server the navigation itself can time out.
     * Since it has never observed a route-level loading state on a phone, a
     * failure here carries no product signal, so it records the miss instead of
     * failing the run and taking the real measurements down with it.
     */
    for (const [from, linkSel, label] of [
      ['/dashboard', 'a[href="/leads"]', '/leads loading.tsx'],
      ['/dashboard', 'a[href="/inbox"]', '/inbox loading.tsx'],
    ] as const) {
      try {
        await goto(page, from)

        // Hold the RSC payload so the fallback stays mounted long enough to read.
        await page.route('**/*_rsc=*', async (route) => {
          await new Promise((r) => setTimeout(r, 4000))
          await route.continue()
        })

        const link = page.locator(linkSel).first()
        if ((await link.count()) === 0) {
          record({ route: from, label, missing: true, note: `no ${linkSel}` })
          continue
        }

        await link.click()
        await page.waitForTimeout(700)

        const shot = await page.evaluate(() => {
          const de = document.documentElement
          const vw = de.clientWidth
          const busy = document.querySelectorAll('[aria-busy="true"], [data-testid*="skeleton"]')
          const over: { sel: string; by: number }[] = []
          for (const el of Array.from(document.querySelectorAll('main#main-content *'))) {
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden') continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            const o = Math.max(r.right - vw, -r.left)
            if (o > 1) {
              over.push({
                sel:
                  el.tagName.toLowerCase() +
                  '.' + (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.'),
                by: Math.round(o),
              })
            }
          }
          const main = document.querySelector('main#main-content') as HTMLElement | null
          return {
            busyCount: busy.length,
            tables: document.querySelectorAll('main#main-content table').length,
            fixedAsides: Array.from(document.querySelectorAll('main#main-content aside')).map((a) =>
              Math.round(a.getBoundingClientRect().width),
            ),
            mainScrollHeight: main ? main.scrollHeight : 0,
            mainClientHeight: main ? main.clientHeight : 0,
            verticalOverflow: main ? main.scrollHeight - main.clientHeight : 0,
            overflow: over.slice(0, 6),
            text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
          }
        })

        record({ route: from, label, loading: shot })
      } catch (err) {
        record({ route: from, label, loading: null, inconclusive: String(err).slice(0, 120) })
      } finally {
        await page.unroute('**/*_rsc=*').catch(() => {})
      }
    }
  })

  test('pressed states — visual feedback without layout shift', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name.startsWith('phone')
    test.skip(!isPhone, 'phone surface')

    await goto(page, '/leads')

    const findings = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="ניווט ראשי"]')
      const tabs = nav ? Array.from(nav.querySelectorAll('a')) : []
      const cards = Array.from(document.querySelectorAll('a[href*="/summary"]'))
      const sample = [...tabs.slice(0, 2), ...cards.slice(0, 2)] as HTMLElement[]

      return sample.map((el) => {
        const cls = el.getAttribute('class') || ''
        const cs = getComputedStyle(el)
        return {
          name: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40).replace(/\s+/g, ' '),
          hasPressClass: cls.split(/\s+/).includes('press'),
          transition: cs.transitionProperty,
          // `scale`/`opacity` only paint; neither reflows, so neighbours cannot move.
          transformIsCompositedOnly: cs.transitionProperty.includes('opacity') || cs.transitionProperty.includes('scale'),
        }
      })
    })

    // The `.press:active` rule is inside `@media (hover: none)`; confirm the
    // emulated context actually matches it, otherwise this measures nothing.
    const mediaMatches = await page.evaluate(() => ({
      hoverNone: window.matchMedia('(hover: none)').matches,
      pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    }))

    record({ route: '/leads', label: 'pressed states', pressed: { mediaMatches, findings } })
  })
})
