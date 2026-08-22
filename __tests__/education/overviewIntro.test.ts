import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getTour } from '@/lib/education/registry'
import { emptyState, recordTour } from '@/lib/education/storage'
import { OVERVIEW_INTRO_VERSION } from '@/lib/education/types'
import {
  isOverviewIntroSettled,
  markOverviewIntroEligible,
  recordOverviewIntro,
  shouldOfferOverviewIntro,
} from '@/lib/education/overviewIntro'

const overview = getTour('overview')!

function eligibleState() {
  return markOverviewIntroEligible(emptyState())
}

describe('shouldOfferOverviewIntro', () => {
  it('does not treat empty education storage as a new user', () => {
    expect(Object.keys(emptyState().tours)).toHaveLength(0)
    expect(shouldOfferOverviewIntro(emptyState(), { overviewVersion: overview.version })).toBe(false)
  })

  it('offers a newly activated user with no leads once eligible is latched', () => {
    expect(shouldOfferOverviewIntro(eligibleState(), { overviewVersion: overview.version })).toBe(true)
  })

  it('does not offer again after accept or decline at the current version', () => {
    expect(
      shouldOfferOverviewIntro(recordOverviewIntro(eligibleState(), 'accepted'), {
        overviewVersion: overview.version,
      }),
    ).toBe(false)
    expect(
      shouldOfferOverviewIntro(recordOverviewIntro(eligibleState(), 'declined'), {
        overviewVersion: overview.version,
      }),
    ).toBe(false)
  })

  it('does not offer when the overview tour is already completed or dismissed', () => {
    expect(
      shouldOfferOverviewIntro(recordTour(eligibleState(), 'overview', overview.version, 'completed'), {
        overviewVersion: overview.version,
      }),
    ).toBe(false)
    expect(
      shouldOfferOverviewIntro(recordTour(emptyState(), 'overview', overview.version, 'dismissed', 3), {
        overviewVersion: overview.version,
      }),
    ).toBe(false)
  })

  it('does not offer an existing user who already ran another tour', () => {
    const withPipeline = recordTour(emptyState(), 'pipeline', 2, 'completed')
    expect(shouldOfferOverviewIntro(withPipeline, { overviewVersion: overview.version })).toBe(false)
    expect(shouldOfferOverviewIntro(markOverviewIntroEligible(withPipeline), { overviewVersion: overview.version })).toBe(true)
  })
})

describe('overview intro record', () => {
  it('is unsettled until accepted or declined at the current version', () => {
    expect(isOverviewIntroSettled(undefined, OVERVIEW_INTRO_VERSION)).toBe(false)
    expect(isOverviewIntroSettled(eligibleState().overviewIntro, OVERVIEW_INTRO_VERSION)).toBe(false)
    expect(
      isOverviewIntroSettled({ version: 0, status: 'declined', at: '2026-01-01T00:00:00.000Z' }, OVERVIEW_INTRO_VERSION),
    ).toBe(false)
    const recorded = recordOverviewIntro(emptyState(), 'declined').overviewIntro
    expect(isOverviewIntroSettled(recorded, OVERVIEW_INTRO_VERSION)).toBe(true)
    expect(recorded?.version).toBe(OVERVIEW_INTRO_VERSION)
  })

  it('does not overwrite accept or decline when latching eligible', () => {
    const declined = recordOverviewIntro(emptyState(), 'declined')
    expect(markOverviewIntroEligible(declined).overviewIntro?.status).toBe('declined')
  })
})

describe('invitation wiring', () => {
  it('reuses the existing workspace gate and does not add a second tour host', () => {
    const layout = readFileSync('app/(app)/layout.tsx', 'utf8')
    /**
     * `toursEnabled` is TOUR ELIGIBILITY. It gained `productAccess.hasAccess`
     * so a tour can never auto-open on top of the paywall, where it stood
     * between a lapsed customer and the renewal path. It is asserted here to
     * keep that term, and to keep it dedicated to tours — the Help button's
     * visibility must NOT be derived from it.
     */
    expect(layout).toContain(
      "productAccess.hasAccess && !trialExpired && trialStatus !== 'NEVER_STARTED' && !mobileWorkspace",
    )
    expect(layout).toContain('isOnboarded')
    expect(layout).toContain('ProActivationSuccess')
    expect(layout).toContain('WelcomeTrialModal')

    const mount = readFileSync('components/education/EducationMount.tsx', 'utf8')
    // The host renders HelpMenu, so it mounts wherever the Help button can be
    // pressed — not only where tours may run. Auto-run stays gated inside it.
    expect(mount).toContain("surface === 'desktop' ? (")
    expect(mount).not.toContain("toursEnabled && surface === 'desktop'")
    expect(mount).toContain('ProductTourHost')

    const tourHost = readFileSync('components/education/ProductTourHost.tsx', 'utf8')
    expect(tourHost.match(/if \(!toursEnabled/g)?.length).toBeGreaterThanOrEqual(3)

    const host = readFileSync('components/education/ProductTourHost.tsx', 'utf8')
    expect(host).not.toContain('OverviewIntroPrompt')
    expect(host).not.toContain('OverviewIntroCard')
    expect(host).toContain('offerOverviewIntro')
    expect(host).toContain('markOverviewIntroEligible')
    expect(host).toContain('useJustActivated')
    expect(host).not.toMatch(/driver\.js/)

    const firstRun = readFileSync('components/clients/LeadsFirstRun.tsx', 'utf8')
    expect(firstRun).not.toContain('OverviewIntro')
    expect(firstRun).not.toContain('{children}')
    const leadsPage = readFileSync('app/(app)/leads/page.tsx', 'utf8')
    expect(leadsPage).not.toContain('OverviewIntroCard')
    expect(leadsPage).not.toContain('OverviewIntroPrompt')
    expect(existsSync('components/education/OverviewIntroPrompt.tsx')).toBe(false)

    const help = readFileSync('components/education/HelpTrigger.tsx', 'utf8')
    expect(help).toContain('data-edu={HELP_TRIGGER_EDU}')
    const runTour = readFileSync('components/education/runTour.ts', 'utf8')
    expect(runTour).toContain('runOverviewIntro')
    expect(runTour).toContain('eduSel(HELP_TRIGGER_EDU)')
    expect(runTour).toContain('showProgress: false')
    expect(runTour).toContain('disableActiveInteraction: true')
    expect(runTour).not.toContain("id: 'overviewIntro'")
  })
})
