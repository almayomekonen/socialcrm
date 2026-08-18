// @vitest-environment jsdom
//
// Regression locks for the four measured A2a fixes.
//
// Each assertion below exists because a MEASUREMENT found the defect, not
// because a rule says it should hold — the numbers are in the A2a report:
//
//   A2a-1  /leads scrolled 600 → lead detail → back → 0, all four phone widths
//   A2a-2  "רענן תובנות" measured 47.8 × 16.5px  (needs ≥44)
//   A2a-3  eight notification chips measured 26px tall (needs ≥44)
//   A2a-4  the lead card — the leads screen's primary tap target — had no
//          pressed state, while the tab bar next to it did
//
// The hit-area fixes are asserted as CLASS CONTRACTS here because `tap-44`'s
// pseudo-element only exists under `@media (pointer: coarse)`, which jsdom does
// not evaluate. The real pixel proof is the Playwright viewport suite; this
// suite stops the class from being dropped.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({
  refreshLeadIntelligence: async () => ({ ok: true }),
}))

import { __test as scrollTest } from '@/components/mobile/useMobileScrollRestoration'
import RefreshLeadIntelligenceButton from '@/components/ai/RefreshLeadIntelligenceButton'
import NotificationFilters from '@/components/notifications/NotificationFilters'
import LeadCardMobile from '@/modules/leads/mobile/LeadCardMobile'
import type { MobileLeadRow } from '@/modules/leads/queries'

afterEach(cleanup)

/* ------------------------------------------------------------------ */
/* A2a-1 — scroll restoration keying                                   */
/* ------------------------------------------------------------------ */

describe('A2a-1 scroll restoration — the key rule is the correctness argument', () => {
  const key = (pathname: string, search: string) =>
    scrollTest.keyFor({ pathname, search } as Location)

  test('a list and its filtered variant are DIFFERENT keys', () => {
    // This is what stops `?status=contacted` inheriting `?status=new`'s offset.
    expect(key('/leads', '?status=new')).not.toBe(key('/leads', '?status=contacted'))
  })

  test('a search change is a different key', () => {
    expect(key('/leads', '?q=dan')).not.toBe(key('/leads', '?q=shira'))
  })

  test('the unfiltered list is a different key from any filtered one', () => {
    expect(key('/leads', '')).not.toBe(key('/leads', '?status=new'))
  })

  test('parameter ORDER does not create a second key for the same list', () => {
    // Otherwise back from a detail page would miss a position saved under a
    // differently-ordered but equivalent URL.
    expect(key('/leads', '?q=dan&status=new')).toBe(key('/leads', '?status=new&q=dan'))
  })

  test('the same list is a stable key across visits', () => {
    expect(key('/leads', '?status=new')).toBe(key('/leads', '?status=new'))
  })

  test('different routes never collide', () => {
    expect(key('/leads', '')).not.toBe(key('/inbox', ''))
    expect(key('/clients/1/summary', '')).not.toBe(key('/clients/2/summary', ''))
  })

  test('keys are namespaced so nothing else in sessionStorage is touched', () => {
    expect(key('/leads', '')).toMatch(/^mws:scroll:/)
    expect(scrollTest.PREFIX).toBe('mws:scroll:')
  })
})

/* ------------------------------------------------------------------ */
/* A2a-2 — refresh insights hit area                                   */
/* ------------------------------------------------------------------ */

describe('A2a-2 refresh-insights hit area', () => {
  test('carries tap-44 (measured 47.8 × 16.5px before the fix)', () => {
    render(<RefreshLeadIntelligenceButton leadId={1} />)
    const btn = screen.getByRole('button', { name: 'רענן תובנות' })
    expect(btn.className.split(/\s+/)).toContain('tap-44')
  })

  test('the VISUAL size is unchanged — tap-44 must not become a resize', () => {
    // The fix was explicitly not allowed to enlarge the control; `text-[11px]`
    // staying put is what keeps desktop pixel-identical.
    render(<RefreshLeadIntelligenceButton leadId={1} />)
    const btn = screen.getByRole('button', { name: 'רענן תובנות' })
    expect(btn.className).toContain('text-[11px]')
    expect(btn.className).not.toMatch(/\bmin-h-|\bh-11\b|\bp-\d/)
  })

  test('keeps its accessible name', () => {
    render(<RefreshLeadIntelligenceButton leadId={1} />)
    expect(screen.getByRole('button', { name: 'רענן תובנות' })).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ */
/* A2a-3 — notification filter chips                                   */
/* ------------------------------------------------------------------ */

/**
 * A2a-3 — DELIBERATELY NOT FIXED. These tests exist to keep it that way.
 *
 * The chips do measure 26px tall on every phone width, which is below the 44px
 * minimum. `tap-44` was applied, MEASURED, and REVERTED: a 44px hit area centred
 * on a 26px chip extends ~9px above and below, while the two filter `nav` rows
 * sit `gap-3` (12px) apart, so hit areas collided between wrapped rows —
 * 7 of 8 chips at 360px and 390px, 5 of 8 at 430px, overlapping 6–12px
 * vertically. That failed the acceptance criterion "adjacent chips do not gain
 * new hit-area collisions", so trading a too-small target for an ambiguous one
 * was rejected.
 *
 * Every cheap alternative was ruled out by the same decision: no wider row gap,
 * no padding or height change, no z-index or pointer-events trickery, no
 * redesign. The real fix is the Phase B move of advanced notification filters
 * into a `BottomSheet` (see `mobile-parity-matrix.md` §2), which removes the
 * wrapped-row geometry entirely rather than patching around it.
 *
 * So these assertions are a HOLD, not an endorsement: they pin the component to
 * its current visual state and fail if someone re-adds `tap-44` without
 * re-measuring the collisions first.
 */
describe('A2a-3 notification filter chips — deferred to Phase B, held unchanged', () => {
  const filters = { unreadOnly: false, category: null } as never

  test('chips do NOT carry tap-44 — re-adding it reintroduces the measured collisions', () => {
    render(<NotificationFilters filters={filters} />)
    const chips = screen.getAllByRole('link')
    expect(chips.length).toBeGreaterThanOrEqual(8)
    for (const chip of chips) {
      expect(chip.className.split(/\s+/), chip.textContent ?? '').not.toContain('tap-44')
    }
  })

  test('the chip is visually unchanged — padding, text size and shape all intact', () => {
    render(<NotificationFilters filters={filters} />)
    for (const chip of screen.getAllByRole('link')) {
      const cls = chip.className
      expect(cls).toContain('px-2.5')
      expect(cls).toContain('py-1')
      expect(cls).toContain('text-xs')
      expect(cls).toContain('rounded-full')
      expect(cls).toContain('inline-flex')
      // No height/size override crept in as a workaround for the target size.
      expect(cls).not.toMatch(/\bmin-h-|\bh-\d|\bpy-(?!1\b)\d/)
    }
  })

  test('no z-index or pointer-events workaround was substituted', () => {
    render(<NotificationFilters filters={filters} />)
    for (const chip of screen.getAllByRole('link')) {
      expect(chip.className).not.toMatch(/\bz-\d|pointer-events-/)
    }
  })

  test('the active chip is still the only one marked current', () => {
    render(<NotificationFilters filters={filters} />)
    const current = screen.getAllByRole('link').filter((c) => c.getAttribute('aria-current') === 'page')
    // "הכל" (read state) and "כל הסוגים" (category) — one per independent axis.
    expect(current).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* A2a-4 — lead card pressed state                                     */
/* ------------------------------------------------------------------ */

describe('A2a-4 lead card pressed state', () => {
  const lead: MobileLeadRow = {
    id: 7,
    name: 'דני לוי',
    phone: '0540000000',
    waPhone: '972540000000',
    email: null,
    status: 'new',
    sourceLabel: 'Facebook Lead Ads',
    sourceChannel: 'facebook',
    nextFollowUpAt: null,
    lastActivityAt: null,
    createdAt: new Date().toISOString(),
    nextAction: null,
    severity: null,
    isNewBadge: false,
    handlerName: null,
  } as unknown as MobileLeadRow

  test('the card link carries press — it is the screen’s primary tap target', () => {
    render(<LeadCardMobile lead={lead} followUp={null} />)
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.includes('/summary'))!
    expect(link.className.split(/\s+/)).toContain('press')
  })

  test('press is applied to the link, never to the row wrapper', () => {
    // Pressing must feed back on the control that was actually tapped; putting
    // it on the row would animate the sibling contact actions too.
    const { container } = render(<LeadCardMobile lead={lead} followUp={null} />)
    const row = container.firstElementChild as HTMLElement
    expect(row.className.split(/\s+/)).not.toContain('press')
  })

  test('the card still links to the lead and keeps its focus ring', () => {
    render(<LeadCardMobile lead={lead} followUp={null} />)
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.includes('/summary'))!
    expect(link.getAttribute('href')).toBe('/clients/7/summary')
    expect(link.className).toContain('focus-visible:ring-2')
  })
})
