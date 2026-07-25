export const TRIAL_LENGTH_DAYS = 7

export type TrialStatus = 'PAID' | 'LEGACY' | 'NEVER_STARTED' | 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED'

export type TrialRow = {
  plan: 'free' | 'pro'
  trialExempt: boolean
  trialStartedAt: Date | string | null
  trialEndsAt: Date | string | null
}

export type TrialState = {
  status: TrialStatus
  endsAt: Date | null
  daysRemaining: number | null
}

const DAY_MS = 86_400_000

/**
 * The trial state machine, as a pure function. Status is never stored —
 * always derived. Precedence (spec §5): PAID → LEGACY → NEVER_STARTED →
 * TRIAL_ACTIVE → TRIAL_EXPIRED. `now` is injected for testability; callers
 * pass `new Date()` (server time only — client clocks are never consulted).
 */
export function getTrialState(row: TrialRow, now: Date): TrialState {
  if (row.plan === 'pro') return { status: 'PAID', endsAt: null, daysRemaining: null }
  if (row.trialExempt) return { status: 'LEGACY', endsAt: null, daysRemaining: null }
  if (!row.trialStartedAt || !row.trialEndsAt) {
    return { status: 'NEVER_STARTED', endsAt: null, daysRemaining: null }
  }
  const endsAt = new Date(row.trialEndsAt)
  if (now.getTime() < endsAt.getTime()) {
    const daysRemaining = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)
    return { status: 'TRIAL_ACTIVE', endsAt, daysRemaining }
  }
  return { status: 'TRIAL_EXPIRED', endsAt, daysRemaining: 0 }
}

/**
 * The canonical "does this agency have the full product right now?" rule,
 * pure over the derived TrialStatus. This is the ONE place that maps lifecycle
 * status → product access, so every gate (lead quota today; more later)
 * classifies identically instead of each re-deciding.
 *
 * IMPORTANT — this is NOT subscription state. `agencies.plan === 'pro'` means a
 * paid subscription; product access is broader: an in-window trial and a
 * grandfathered (LEGACY) agency also have full access while still being
 * plan='free'. Never substitute `plan === 'pro'` for this, and never use this
 * to answer a billing question.
 *
 *   PAID          → true   (paid subscription)
 *   TRIAL_ACTIVE  → true   (inside the 7-day trial)
 *   LEGACY        → true   (grandfathered / trialExempt)
 *   TRIAL_EXPIRED → false  (trial over, no subscription)
 *   NEVER_STARTED → false  (has not started the trial yet)
 */
export function hasActiveProductAccess(status: TrialStatus): boolean {
  return status === 'PAID' || status === 'TRIAL_ACTIVE' || status === 'LEGACY'
}
