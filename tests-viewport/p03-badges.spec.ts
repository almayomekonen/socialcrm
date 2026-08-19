import { test, expect, type Page } from '@playwright/test'
import { probeOverflow, probeTargets, probeInputs, probeSafeArea } from './probes'

/**
 * P0-3 — THE TWO MOBILE TAB-BAR BADGES, VERIFIED AGAINST THE DATABASE.
 *
 * ASSERTION, NOT MEASUREMENT. Unlike `a2a-measure.spec.ts` (which records
 * numbers and never fails), this spec fails on a defect: it exists to prove one
 * specific bug is gone and cannot come back.
 *
 * THE BUG. `app/(app)/layout.tsx` passed `inboxUnread` — unread WhatsApp
 * CONVERSATIONS — into `MobileWorkspaceShell notificationCount`, and
 * `mobileTabsWithBadges` put that number on the התראות tab. Reading every
 * notification therefore never cleared the badge; only replying to WhatsApp did.
 *
 * WHY THE FIXTURE USES DISTINCT NON-ZERO COUNTS. With the two numbers equal, a
 * swapped wiring produces an identical screen and the run passes while the
 * product is broken. The fixture stages 3 unread notifications and exactly 1
 * unread conversation, and the expected values are read from the SAME two
 * functions the server calls (`P03_NOTIFICATIONS` / `P03_CONVERSATIONS` come
 * from a ground-truth probe), so this asserts the wiring rather than a guess.
 *
 * ENTITY. The phone projects carry an iPhone UA, so the server renders the
 * mobile workspace; the desktop projects carry a desktop UA and must render the
 * desktop shell with NO tab bar at all (architecture-rules.md §9).
 */

const TOKEN = process.env.MOBILE_QA_TOKEN || ''
const EXPECTED_NOTIFICATIONS = Number(process.env.P03_NOTIFICATIONS ?? '')
const EXPECTED_CONVERSATIONS = Number(process.env.P03_CONVERSATIONS ?? '')

const OVERFLOW_TOLERANCE = 1
const MIN_TARGET = 44

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
  if (!Number.isFinite(EXPECTED_NOTIFICATIONS) || !Number.isFinite(EXPECTED_CONVERSATIONS)) {
    throw new Error('P03_NOTIFICATIONS and P03_CONVERSATIONS must be set from the ground-truth probe.')
  }
  // A fixture where the two counts match would make a swap invisible.
  expect(EXPECTED_NOTIFICATIONS).not.toBe(EXPECTED_CONVERSATIONS)
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

/** The tab bar's accessible names are the contract: `${title}, ${badge} חדשות`. */
async function tabBadges(page: Page): Promise<{ notifications: number | null; conversations: number | null }> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="ניווט ראשי"]')
    if (!nav) return { notifications: null, conversations: null }

    const read = (href: string): number | null => {
      const link = nav.querySelector(`a[href="${href}"]`)
      if (!link) return null
      const label = link.getAttribute('aria-label')
      // No aria-label ⇒ no badge ⇒ zero unread (the component omits it at 0).
      if (!label) return 0
      const m = label.match(/(\d+)/)
      return m ? Number(m[1]) : 0
    }

    return { notifications: read('/notifications'), conversations: read('/inbox') }
  })
}

test.describe('P0-3 mobile tab-bar badges', () => {
  test('badges are sourced independently and match the database', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })

    const badges = await tabBadges(page)

    // THE FIX. Each tab shows its own count.
    expect(badges.notifications, 'התראות badge must be the unread NOTIFICATION count').toBe(EXPECTED_NOTIFICATIONS)
    expect(badges.conversations, 'שיחות badge must be the unread CONVERSATION count').toBe(EXPECTED_CONVERSATIONS)

    // THE BUG, named explicitly: the old build put the conversation count here.
    expect(
      badges.notifications,
      'regression: התראות is showing the conversation count again',
    ).not.toBe(EXPECTED_CONVERSATIONS)
  })

  test('the badge survives a reload and a back navigation', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })
    expect((await tabBadges(page)).notifications).toBe(EXPECTED_NOTIFICATIONS)

    // Navigate to another tab and back — the server-rendered count must persist.
    await page.click('nav[aria-label="ניווט ראשי"] a[href="/leads"]')
    await page.waitForURL('**/leads**', { timeout: 60_000 })
    await page.goBack()
    await page.waitForURL('**/dashboard**', { timeout: 60_000 })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })

    const afterBack = await tabBadges(page)
    expect(afterBack.notifications, 'badge lost after back navigation').toBe(EXPECTED_NOTIFICATIONS)
    expect(afterBack.conversations, 'conversation badge lost after back navigation').toBe(EXPECTED_CONVERSATIONS)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })
    const afterReload = await tabBadges(page)
    expect(afterReload.notifications, 'badge lost after reload').toBe(EXPECTED_NOTIFICATIONS)
    expect(afterReload.conversations, 'conversation badge lost after reload').toBe(EXPECTED_CONVERSATIONS)
  })

  test('the notifications screen itself is clean at this width', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')

    await page.goto('/notifications', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 60_000 })

    const overflow = await page.evaluate(probeOverflow, OVERFLOW_TOLERANCE)
    expect(overflow.elements, `horizontal overflow: ${JSON.stringify(overflow.elements.slice(0, 3))}`).toHaveLength(0)

    const targets = await page.evaluate(probeTargets, MIN_TARGET)
    const undersized = targets.filter((t) => t.minSide < MIN_TARGET)
    expect(undersized, `sub-44px targets: ${JSON.stringify(undersized.slice(0, 3))}`).toHaveLength(0)

    const inputs = await page.evaluate(probeInputs)
    const zoomers = inputs.filter((i) => i.zoomRisk)
    expect(zoomers, `iOS zoom risk: ${JSON.stringify(zoomers)}`).toHaveLength(0)

    // The tab bar must pay the home-indicator inset, and nothing may double-pay.
    const safe = await page.evaluate(probeSafeArea)
    expect(safe.consumers.length, 'no element pays the safe-area inset').toBeGreaterThan(0)
    expect(safe.nestedPairs, `nested safe-area payers: ${JSON.stringify(safe.nestedPairs)}`).toHaveLength(0)

    // No desktop table smuggled into the phone entity.
    expect(await page.locator('table').count(), 'desktop table inside the mobile workspace').toBe(0)
  })
})

test.describe('P0-3 desktop regression', () => {
  test('desktop renders no mobile tab bar and keeps its own inbox badge', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'desktop entity only')
    test.skip(testInfo.project.name.startsWith('tablet-'), 'covered by the desktop projects')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    // Wait for the DESKTOP shell to actually exist before asserting anything
    // about it — `domcontentloaded` alone can fire before the nav renders, and
    // an assertion against an empty page proves nothing.
    // `attached`, not `visible`: this test asserts what is PRESENT in the
    // desktop DOM. The desktop nav renders more than one `/inbox` link (a
    // sidebar and a drawer), and whichever is off-canvas at a given width is
    // attached but not visible — waiting for visibility times out on a page
    // that is in fact fully rendered.
    await page.waitForSelector('a[href="/inbox"]', { state: 'attached', timeout: 60_000 })

    /**
     * Prevention by absence: the mobile chrome must not exist in desktop HTML.
     *
     * NOT MATCHED BY aria-label. `lib/navs/Nav.tsx` gives the DESKTOP nav the
     * same accessible name ('ניווט ראשי') — correctly, since it is that
     * document's primary navigation — so selecting on it finds the desktop nav
     * and reports a leak that is not there. The unambiguous markers are the
     * shell's own `data-mobile-workspace` attribute and the `/m` tab, which
     * exists only in `MOBILE_TABS`.
     */
    expect(await page.locator('[data-mobile-workspace]').count(), 'mobile shell leaked into desktop').toBe(0)
    expect(
      await page.locator('nav a[href="/m"]').count(),
      'mobile tab bar (its /m tab) leaked into the desktop entity',
    ).toBe(0)

    // The desktop nav still badges CONVERSATIONS on /inbox, unchanged by P0-3.
    // Read EVERY /inbox link: the desktop nav renders the sidebar and the drawer,
    // and only the one currently on-canvas carries the rendered badge.
    const inboxTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href="/inbox"]')).map((el) =>
        (el.textContent || '').replace(/\s+/g, ' ').trim(),
      ),
    )
    expect(inboxTexts.length, 'desktop /inbox nav link missing').toBeGreaterThan(0)
    expect(
      inboxTexts.some((t) => t.includes(String(EXPECTED_CONVERSATIONS))),
      `desktop inbox badge lost its conversation count — links: ${JSON.stringify(inboxTexts)}`,
    ).toBe(true)

    /**
     * DESKTOP OVERFLOW — EXCLUDING ONE PROVEN PRE-EXISTING SOURCE.
     *
     * The collapsed CopilotShell panel ("עוזר חכם") sits off-canvas at
     * left:-332, with ten descendants reported as left-side overflow at both
     * desktop widths.
     *
     * IT IS NOT CAUSED BY P0-3, and that was verified rather than assumed: the
     * same run against this branch with the three source edits reverted
     * (`git checkout --` on layout / MobileTabBar / MobileWorkspaceShell) reports
     * an IDENTICAL ten findings with identical `overflowBy` values. P0-3 adds one
     * server-side read guarded by `mobileWorkspace`, so it cannot reach the
     * desktop render path at all.
     *
     * Note the document-level metric cannot substitute here: `body` computes
     * `overflow-x: hidden`, so `documentScrollWidth === clientWidth` at both
     * widths regardless of what actually overflows. Per-element is the only
     * honest measurement — which is why the exclusion is narrow and named
     * rather than the assertion being dropped. Anything overflowing OUTSIDE
     * that panel still fails. Fixing the panel is out of scope for P0-3.
     *
     * Measured by DOM ANCESTRY, not by selector string: `probeOverflow`
     * serialises a truncated ancestor chain, so a deep descendant of the panel
     * no longer mentions the `aside` and a substring filter silently misses it.
     * `closest('aside')` asks the question directly.
     */
    const offending = await page.evaluate((tolerance) => {
      const vw = document.documentElement.clientWidth
      const out: { name: string; left: number; right: number; overflowBy: number }[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        // The collapsed CopilotShell panel — see the note below.
        if (el.closest('aside')) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const over = Math.max(0 - r.left, r.right - vw)
        if (over > tolerance) {
          out.push({
            name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
            left: Math.round(r.left),
            right: Math.round(r.right),
            overflowBy: Math.round(over),
          })
        }
      }
      return out
    }, OVERFLOW_TOLERANCE)

    expect(
      offending,
      `NEW desktop overflow outside the pre-existing Copilot panel: ${JSON.stringify(offending.slice(0, 3))}`,
    ).toHaveLength(0)
  })
})
