import { isSettled } from './eligibility'
import { OVERVIEW_INTRO_VERSION, type EducationState, type OverviewIntroRecord, type OverviewIntroStatus } from './types'

function isIntroRecord(value: unknown): value is OverviewIntroRecord {
  if (!value || typeof value !== 'object') return false
  const v = value as OverviewIntroRecord
  return (
    typeof v.version === 'number' &&
    (v.status === 'eligible' || v.status === 'accepted' || v.status === 'declined') &&
    typeof v.at === 'string'
  )
}

export function parseOverviewIntro(value: unknown): OverviewIntroRecord | undefined {
  return isIntroRecord(value) ? value : undefined
}

export function isOverviewIntroSettled(record: OverviewIntroRecord | undefined, version: number): boolean {
  if (!record) return false
  if (record.version < version) return false
  return record.status === 'accepted' || record.status === 'declined'
}

/**
 * First-time overview invitation. Empty education storage is NOT enough —
 * that is the existing-user case after this feature ships.
 *
 * Eligible only after the existing Pro activation signal has been latched
 * (`justActivated` → `overviewIntro.status = 'eligible'`).
 */
export function shouldOfferOverviewIntro(
  state: EducationState,
  opts: { introVersion?: number; overviewVersion: number },
): boolean {
  const introVersion = opts.introVersion ?? OVERVIEW_INTRO_VERSION
  if (isOverviewIntroSettled(state.overviewIntro, introVersion)) return false
  if (isSettled(state.tours.overview, opts.overviewVersion)) return false
  const intro = state.overviewIntro
  return !!intro && intro.version >= introVersion && intro.status === 'eligible'
}

/** Latch from the in-memory Pro activation signal. Does not overwrite accept/decline. */
export function markOverviewIntroEligible(state: EducationState): EducationState {
  if (isOverviewIntroSettled(state.overviewIntro, OVERVIEW_INTRO_VERSION)) return state
  if (state.overviewIntro?.status === 'eligible' && state.overviewIntro.version >= OVERVIEW_INTRO_VERSION) {
    return state
  }
  return {
    ...state,
    overviewIntro: {
      version: OVERVIEW_INTRO_VERSION,
      status: 'eligible',
      at: new Date().toISOString(),
    },
  }
}

export function recordOverviewIntro(state: EducationState, status: Exclude<OverviewIntroStatus, 'eligible'>): EducationState {
  return {
    ...state,
    overviewIntro: {
      version: OVERVIEW_INTRO_VERSION,
      status,
      at: new Date().toISOString(),
    },
  }
}
