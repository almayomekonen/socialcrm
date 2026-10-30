// @vitest-environment jsdom
//
// HELP IS NOT A TOUR.
//
// `toursEnabled` gained `productAccess.hasAccess` so a guided tour could never
// auto-open on top of the paywall — correct, and deliberately preserved here.
// But `HelpTrigger` read the same flag, so the fix took the Help button with it
// and the customer least able to self-serve lost the way to ask.
//
// These prove the two concerns are now separate in BOTH directions: the button
// survives `toursEnabled: false`, and no tour starts because it did.
//
// No DB: runs in the no-DB suite.

import { he } from '@/lib/i18n/messages/he'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const read = (p: string) => readFileSync(p, 'utf8')

/**
 * The same file with comments stripped. Assertions about what the CODE does
 * must not be broken by a comment that merely NAMES the thing it decoupled from.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const { runTour, runOverviewIntro, recordEducationEvent } = vi.hoisted(() => ({
  runTour: vi.fn(async () => null),
  runOverviewIntro: vi.fn(async () => null),
  recordEducationEvent: vi.fn(async () => {}),
}))

vi.mock('@/components/education/runTour', () => ({
  runTour,
  runOverviewIntro,
  stopActiveTour: vi.fn(),
  waitForTourTargets: vi.fn(async () => true),
}))
vi.mock('@/actions/education/recordEducationEvent', () => ({ recordEducationEvent }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

import EducationMount from '@/components/education/EducationMount'
import HelpTrigger from '@/components/education/HelpTrigger'

const USER_ID = 7

function mount(opts: { surface: 'desktop' | 'mobile'; toursEnabled: boolean }) {
  return render(
    <EducationMount userId={USER_ID} surface={opts.surface} copilotEnabled={false} toursEnabled={opts.toursEnabled}>
      <HelpTrigger />
    </EducationMount>,
  )
}

const helpButton = () => screen.queryByRole('button', { name: 'עזרה' })

beforeEach(() => {
  localStorage.clear()
  runTour.mockClear()
  runOverviewIntro.mockClear()
  recordEducationEvent.mockClear()
})
afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * Visibility.
 * ------------------------------------------------------------------ */

describe('the Help button is visible whenever the desktop workspace is', () => {
  it('renders for an expired desktop session (toursEnabled: false)', () => {
    mount({ surface: 'desktop', toursEnabled: false })
    expect(helpButton()).toBeTruthy()
  })

  it('still renders for an active desktop session', () => {
    mount({ surface: 'desktop', toursEnabled: true })
    expect(helpButton()).toBeTruthy()
  })

  it('toursEnabled: false does not hide it — the two are independent', () => {
    const { unmount } = mount({ surface: 'desktop', toursEnabled: true })
    expect(helpButton()).toBeTruthy()
    unmount()
    mount({ surface: 'desktop', toursEnabled: false })
    expect(helpButton()).toBeTruthy()
  })

  it('remains hidden on mobile, tours enabled or not', () => {
    const { unmount } = mount({ surface: 'mobile', toursEnabled: true })
    expect(helpButton()).toBeNull()
    unmount()
    mount({ surface: 'mobile', toursEnabled: false })
    expect(helpButton()).toBeNull()
  })

  it('reads surface, and no longer reads toursEnabled', () => {
    const src = code('components/education/HelpTrigger.tsx')
    expect(src).toContain("if (surface !== 'desktop') return null")
    expect(src).not.toContain('toursEnabled')
    // it must not have grown its own entitlement opinion either
    expect(src).not.toMatch(/hasAccess|productAccess|useAccessDenied|useEntitlement/)
  })
})

/* ------------------------------------------------------------------ *
 * The button must not become a tour trigger.
 * ------------------------------------------------------------------ */

describe('a visible Help button starts no guided tour by itself', () => {
  it('an expired desktop session auto-starts nothing', async () => {
    mount({ surface: 'desktop', toursEnabled: false })
    await waitFor(() => expect(helpButton()).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(runTour).not.toHaveBeenCalled()
    expect(runOverviewIntro).not.toHaveBeenCalled()
  })

  it('opening Help explicitly still starts no tour on its own', async () => {
    mount({ surface: 'desktop', toursEnabled: false })
    fireEvent.click(helpButton()!)
    await waitFor(() => expect(recordEducationEvent).toHaveBeenCalled())
    expect(runTour).not.toHaveBeenCalled()
    expect(runOverviewIntro).not.toHaveBeenCalled()
  })

  /** The menu must actually mount, or the button would open nothing. */
  it('the Help menu opens for an expired session', async () => {
    mount({ surface: 'desktop', toursEnabled: false })
    fireEvent.click(helpButton()!)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'עזרה' })).toBeTruthy())
    expect(screen.getByText('סיור קצר, מדריכים, או דיווח על בעיה.')).toBeTruthy()
  })

  it('every auto-run path inside the host is still gated on toursEnabled', () => {
    const host = read('components/education/ProductTourHost.tsx')
    expect(host.match(/if \(!toursEnabled/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('the layout keeps hasAccess in tour eligibility', () => {
    expect(read('app/(app)/layout.tsx')).toContain(
      "productAccess.hasAccess && !trialExpired && trialStatus !== 'NEVER_STARTED' && !mobileWorkspace",
    )
  })
})

/* ------------------------------------------------------------------ *
 * The tour anchor.
 * ------------------------------------------------------------------ */

describe('HELP_TRIGGER_EDU does not become a broken anchor', () => {
  it('the button still carries the anchor attribute', () => {
    mount({ surface: 'desktop', toursEnabled: true })
    expect(helpButton()!.getAttribute('data-edu')).toBe('help-trigger')
  })

  it('and carries it for an expired session too, so the selector never dangles', () => {
    mount({ surface: 'desktop', toursEnabled: false })
    expect(helpButton()!.getAttribute('data-edu')).toBe('help-trigger')
  })

  /**
   * The intro anchors its only step to this element. Making the button MORE
   * present can only improve that; the intro is separately gated so it never
   * runs for a session that cannot be toured.
   */
  it('the overview intro still waits for the target rather than assuming it', () => {
    const src = read('components/education/runTour.ts')
    expect(src).toContain('eduSel(HELP_TRIGGER_EDU)')
    expect(src).toContain('const ready = await waitForTourTargets(steps)')
    expect(src).toContain('if (!ready) return null')
  })
})

/* ------------------------------------------------------------------ *
 * Blast radius.
 * ------------------------------------------------------------------ */

describe('nothing outside the education system moved', () => {
  it('no entitlement or payment logic was touched', () => {
    for (const f of ['components/education/HelpTrigger.tsx', 'components/education/EducationMount.tsx']) {
      const src = code(f)
      expect(src, f).not.toMatch(/getAgencyProductAccess|requireProductAccess|pollGate|proToast|upgradeHref|payments/)
    }
    // The canonical resolver and guard are untouched.
    expect(read('lib/access/productAccess.ts')).toContain('export const getAgencyProductAccess = cache(')
    expect(read('lib/requireUser.ts')).toContain('export async function requireProductAccess')
  })

  it('the menu itself was not redesigned', () => {
    const menu = read('components/education/HelpMenu.tsx')
    expect(menu).toContain('ModalPop')
    // The labels come from the catalog (Phase E6); in Hebrew they are the same words.
    const copy = read('lib/i18n/messages/he/education/chrome.ts')
    expect(menu).toContain("t('education.help.overview')")
    expect(menu).toContain("t('education.help.guides')")
    expect(menu).toContain("t('education.help.problem')")
    expect(copy).toContain("overview: 'הראה לי איך המערכת עובדת'")
    expect(copy).toContain("guides: 'מדריכים'")
    expect(copy).toContain("problem: 'יש לי בעיה'")
  })

  it('the trigger reuses the existing icon, with no new visual system', () => {
    const src = code('components/education/HelpTrigger.tsx')
    expect(src).toContain("name='circle-question'")
    // The accessible name comes from the interface-language catalog; in Hebrew it is still עזרה.
    expect(src).toContain("aria-label={t('shell.help')}")
    expect(he.shell.help).toBe('עזרה')
    expect(src).not.toMatch(/warning-bg|bg-red|toast/)
  })
})
