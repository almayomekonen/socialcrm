// @vitest-environment jsdom
//
// A CLICKED TOUR IS NOT AN AUTOMATIC TOUR.
//
// `toursEnabled` carries `productAccess.hasAccess` so a tour can never
// auto-open on top of the paywall. Applied to a tour the customer explicitly
// clicked in the Help menu, it produced a dead button: the menu closed and
// nothing happened, while a server-side analytics write still fired.
//
// The exemption is keyed on `source === 'help'`, never on `force` — `force` is
// also used by the query-param launch, the copilot auto-start and the overview
// intro, none of which a human asked for at that moment.
//
// These prove both halves: Help works, and nothing else got in with it.
//
// No DB: runs in the no-DB suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { isTourEligible } from '@/lib/education'
import type { TourDefinition } from '@/lib/education/types'

const read = (p: string) => readFileSync(p, 'utf8')

/** Comments quote the old default verbatim; assertions must read CODE only. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const { runTour, runOverviewIntro, recordEducationEvent, routerReplace, routerPush } = vi.hoisted(() => ({
  runTour: vi.fn(async (..._args: unknown[]) => null),
  runOverviewIntro: vi.fn(async () => null),
  recordEducationEvent: vi.fn(async () => {}),
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
}))

let searchParams = new URLSearchParams()
let pathname = '/dashboard'

vi.mock('@/components/education/runTour', () => ({
  runTour,
  runOverviewIntro,
  stopActiveTour: vi.fn(),
  waitForTourTargets: vi.fn(async () => true),
}))
vi.mock('@/actions/education/recordEducationEvent', () => ({ recordEducationEvent }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

import EducationMount from '@/components/education/EducationMount'
import HelpTrigger from '@/components/education/HelpTrigger'

const USER_ID = 11

function mount(toursEnabled: boolean, surface: 'desktop' | 'mobile' = 'desktop') {
  return render(
    <EducationMount userId={USER_ID} surface={surface} copilotEnabled={false} toursEnabled={toursEnabled}>
      <HelpTrigger />
    </EducationMount>,
  )
}

async function openHelpMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'עזרה' })).toBeTruthy())
}

/**
 * The cleanup rebuilds the query from `window.location.search`, i.e. the LIVE
 * URL, not from the hook. Drive both so the test exercises the real path.
 */
function atUrl(url: string) {
  window.history.replaceState({}, '', url)
  const [path, qs] = url.split('?')
  pathname = path
  searchParams = new URLSearchParams(qs ?? '')
}

/** A minimal definition; the real ones live in the registry. */
const DEF = (over: Partial<TourDefinition> = {}) =>
  ({ id: 'overview', version: 1, auto: false, steps: [], ...over }) as TourDefinition

const CTX = {
  surface: 'desktop' as const,
  toursEnabled: false,
  copilotEnabled: false,
  firstLeadActive: false,
  pathname: '/dashboard',
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/dashboard')
  searchParams = new URLSearchParams()
  pathname = '/dashboard'
  runTour.mockClear()
  runOverviewIntro.mockClear()
  recordEducationEvent.mockClear()
  routerReplace.mockClear()
  routerPush.mockClear()
})
afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * The rule itself.
 * ------------------------------------------------------------------ */

describe('the exemption is keyed on who asked, not on force', () => {
  it('force + source help runs even when auto-run is off', () => {
    expect(isTourEligible(DEF(), { ...CTX, force: true, source: 'help' })).toBe(true)
  })

  it.each(['auto', 'query', 'copilot'] as const)(
    'force + source %s does NOT run when auto-run is off',
    (source) => {
      expect(isTourEligible(DEF(), { ...CTX, force: true, source })).toBe(false)
    },
  )

  it('force with no source at all does NOT run when auto-run is off', () => {
    expect(isTourEligible(DEF(), { ...CTX, force: true })).toBe(false)
  })

  it('an automatic tour does not run when auto-run is off', () => {
    expect(isTourEligible(DEF({ auto: true }), { ...CTX })).toBe(false)
  })

  /** Help may bypass the auto-run gate. It may not bypass a safety rule. */
  it('Help cannot bypass the desktop surface rule', () => {
    expect(isTourEligible(DEF(), { ...CTX, surface: 'mobile', force: true, source: 'help' })).toBe(false)
  })

  it('Help cannot bypass a copilot requirement', () => {
    const def = DEF({ requiresCopilot: true })
    expect(isTourEligible(def, { ...CTX, copilotEnabled: false, force: true, source: 'help' })).toBe(false)
    expect(isTourEligible(def, { ...CTX, copilotEnabled: true, force: true, source: 'help' })).toBe(true)
  })

  it('Help cannot bypass the first-lead restriction', () => {
    const def = DEF({ blockedByFirstLead: true })
    expect(isTourEligible(def, { ...CTX, firstLeadActive: true, force: true, source: 'help' })).toBe(false)
  })

  it('the safety rules are checked before the exemption, in source order', () => {
    const src = read('lib/education/eligibility.ts')
    const surfaceAt = src.indexOf("if (ctx.surface !== 'desktop') return false")
    const copilotAt = src.indexOf('if (def.requiresCopilot')
    const firstLeadAt = src.indexOf('if (def.blockedByFirstLead')
    const exemptionAt = src.indexOf("if (ctx.force && ctx.source === 'help') return true")
    const gateAt = src.indexOf('if (!ctx.toursEnabled) return false')
    for (const [name, at] of [
      ['surface', surfaceAt],
      ['copilot', copilotAt],
      ['firstLead', firstLeadAt],
    ] as const) {
      expect(at, name).toBeGreaterThan(-1)
      expect(at, name).toBeLessThan(exemptionAt)
    }
    expect(exemptionAt).toBeLessThan(gateAt) // the exemption precedes the auto-run gate
  })
})

/* ------------------------------------------------------------------ *
 * Active users are unaffected.
 * ------------------------------------------------------------------ */

describe('existing behaviour for an active session is unchanged', () => {
  it('a forced tour from any source still runs when tours are enabled', () => {
    for (const source of ['help', 'query', 'copilot', 'auto'] as const) {
      expect(isTourEligible(DEF(), { ...CTX, toursEnabled: true, force: true, source }), source).toBe(true)
    }
  })

  it('auto: false still refuses an unforced start when tours are enabled', () => {
    expect(isTourEligible(DEF({ auto: false }), { ...CTX, toursEnabled: true })).toBe(false)
  })

  it('a settled record still refuses an unforced start when tours are enabled', () => {
    const def = DEF({ auto: true, version: 2 })
    const record = { version: 2, status: 'completed' as const, at: '2026-08-01T00:00:00.000Z' }
    expect(isTourEligible(def, { ...CTX, toursEnabled: true, record })).toBe(false)
    // …and force still overrides completion, exactly as before.
    expect(isTourEligible(def, { ...CTX, toursEnabled: true, force: true, source: 'query', record })).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * End to end through the Help menu.
 * ------------------------------------------------------------------ */

describe('the two Help actions are no longer dead buttons', () => {
  it('overview starts for an expired desktop session', async () => {
    mount(false)
    await openHelpMenu()
    fireEvent.click(screen.getByRole('button', { name: /הראה לי איך המערכת עובדת/ }))
    await waitFor(() => expect(runTour).toHaveBeenCalledTimes(1))
    expect(runTour.mock.calls[0][0]).toMatchObject({ id: 'overview' })
  })

  it('pipeline starts for an expired desktop session already on /leads', async () => {
    pathname = '/leads'
    mount(false)
    await openHelpMenu()
    fireEvent.click(screen.getByRole('button', { name: /סיור בלידים/ }))
    await waitFor(() => expect(runTour).toHaveBeenCalledTimes(1))
    expect(runTour.mock.calls[0][0]).toMatchObject({ id: 'pipeline' })
  })

  it('pipeline navigates to /leads when the session is elsewhere', async () => {
    mount(false)
    await openHelpMenu()
    fireEvent.click(screen.getByRole('button', { name: /סיור בלידים/ }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/leads?tour=pipeline'))
  })

  it('and both still work for an active session', async () => {
    mount(true)
    await openHelpMenu()
    fireEvent.click(screen.getByRole('button', { name: /הראה לי איך המערכת עובדת/ }))
    await waitFor(() => expect(runTour).toHaveBeenCalledTimes(1))
  })

  it('no Pro toast or billing destination was introduced', () => {
    for (const f of [
      'components/education/HelpMenu.tsx',
      'lib/education/eligibility.ts',
      'components/education/ProductTourHost.tsx',
      'components/education/EducationProvider.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/proToast|upgradeHref|api\/payments|SubscriptionExpiredState/)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Automatic tours stay off.
 * ------------------------------------------------------------------ */

describe('automatic tours remain disabled when toursEnabled is false', () => {
  it('mounting an expired desktop session starts nothing on its own', async () => {
    mount(false)
    await new Promise((r) => setTimeout(r, 80))
    expect(runTour).not.toHaveBeenCalled()
    expect(runOverviewIntro).not.toHaveBeenCalled()
  })

  it('a ?tour= param does not auto-start a tour', async () => {
    atUrl('/leads?tour=pipeline')
    mount(false)
    await new Promise((r) => setTimeout(r, 80))
    expect(runTour).not.toHaveBeenCalled()
  })

  it('every force:true call site names its source, and only Help says help', () => {
    const sites = [
      ['components/education/ProductTourHost.tsx', 'source }'],
      ['components/education/HelpMenu.tsx', "source: 'help'"],
      ['components/education/EducationProvider.tsx', "source: 'copilot'"],
    ] as const
    for (const [file, marker] of sites) expect(read(file), file).toContain(marker)

    // 'help' is claimed explicitly and can never be inferred from force.
    const provider = code('components/education/EducationProvider.tsx')
    expect(provider).toContain("const source: TourStartSource = opts?.source ?? 'auto'")
    expect(provider).not.toContain("opts?.force ? 'help' : 'auto'")

    // Only the Help menu may pass source: 'help'.
    for (const f of ['components/education/ProductTourHost.tsx', 'components/education/EducationProvider.tsx']) {
      expect(code(f), f).not.toContain("source: 'help'")
    }
  })
})

/* ------------------------------------------------------------------ *
 * The stale URL.
 * ------------------------------------------------------------------ */

describe('a consumed ?tour= param never sticks to the URL', () => {
  it('is cleaned up even when the tour is declined', async () => {
    atUrl('/leads?tour=pipeline')
    mount(false)
    await waitFor(() => expect(routerReplace).toHaveBeenCalled())
    expect(routerReplace.mock.calls[0][0]).toBe('/leads')
    expect(runTour).not.toHaveBeenCalled() // declined, but the URL is clean
  })

  it('is cleaned up when the tour does run', async () => {
    atUrl('/leads?tour=pipeline')
    mount(true)
    await waitFor(() => expect(routerReplace).toHaveBeenCalled())
    expect(routerReplace.mock.calls[0][0]).toBe('/leads')
  })

  it('preserves any other query parameters', async () => {
    atUrl('/leads?tour=pipeline&status=new')
    mount(false)
    await waitFor(() => expect(routerReplace).toHaveBeenCalled())
    expect(routerReplace.mock.calls[0][0]).toBe('/leads?status=new')
  })

  it('the cleanup precedes the launch gate in source', () => {
    const src = read('components/education/ProductTourHost.tsx')
    const replaceAt = src.indexOf('router.replace(qs ?')
    const gateAt = src.indexOf('if (!toursEnabled) return')
    expect(replaceAt).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(replaceAt)
  })
})
