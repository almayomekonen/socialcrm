export const TRIAL_LENGTH_DAYS = 7

export type TrialStatus = 'PAID' | 'LEGACY' | 'NEVER_STARTED' | 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED'

export type TrialRow = {
  plan: 'free' | 'pro'
  trialExempt: boolean
  trialStartedAt: Date | string | null
  trialEndsAt: Date | string | null
  /** agencies.planReason — discriminates grow prepaid vs admin/manual grant. */
  planReason?: string | null
  /** subscriptions.expiresAt — LEFT JOINed server-side; NEVER from the client. */
  expiresAt?: Date | string | null
  /**
   * Card-required trial only: when the first charge attempt may still be
   * resolving after trialEndsAt (db/payments/conversionGrace.ts). NULL/absent
   * for every agency without an active card — behaviour unchanged.
   */
  conversionGraceEndsAt?: Date | string | null
}

export type TrialState = {
  status: TrialStatus
  endsAt: Date | null
  daysRemaining: number | null
}

/** Minimal shape for the canonical prepaid-period decision. */
export type PaidPeriodRow = {
  plan: 'free' | 'pro'
  planReason?: string | null
  expiresAt?: Date | string | null
}

const DAY_MS = 86_400_000

/**
 * Model B canonical prepaid-period truth — the ONE place that decides whether a
 * paid period is currently active. Server time only; a client-supplied date is
 * never consulted. `agencies.plan==='pro'` by itself is NOT sufficient.
 *
 *   grow prepaid  (planReason 'grow:*'): active strictly while expiresAt > now
 *                                        (0-day grace; expired ⇒ not active).
 *   admin/manual  (any non-'grow:*' reason): active while plan='pro' (an explicit
 *                                        grant has no prepaid expiry).
 *
 * The 'grow:' discriminator matches the existing `derivePlanSource` classifier
 * and the verified production planReason values (grow:* always paired with a
 * subscription row; admin-grant* without one). Reused by getTrialState and by
 * the AI entitlement source so date logic lives in exactly one function.
 */
export function isPaidPeriodActive(row: PaidPeriodRow, now: Date): boolean {
  if (row.plan !== 'pro') return false
  const isPrepaid = (row.planReason ?? '').startsWith('grow:')
  if (!isPrepaid) return true // explicit admin/manual grant — no prepaid expiry
  if (!row.expiresAt) return false // grow-paid but no period row ⇒ not active
  return new Date(row.expiresAt).getTime() > now.getTime()
}

/**
 * The trial state machine, as a pure function. Status is never stored —
 * always derived. Precedence (spec §5): PAID → LEGACY → NEVER_STARTED →
 * TRIAL_ACTIVE → TRIAL_EXPIRED. `now` is injected for testability; callers
 * pass `new Date()` (server time only — client clocks are never consulted).
 *
 * Model B: PAID is no longer `plan==='pro'` forever — it requires an ACTIVE
 * paid period (isPaidPeriodActive). An expired grow prepaid agency falls through
 * to the trial branches: a previously-paid customer whose historical trial is
 * already over resolves to TRIAL_EXPIRED (never reactivates an old trial).
 */
export function getTrialState(row: TrialRow, now: Date): TrialState {
  if (isPaidPeriodActive(row, now)) return { status: 'PAID', endsAt: null, daysRemaining: null }
  if (row.trialExempt) return { status: 'LEGACY', endsAt: null, daysRemaining: null }
  if (!row.trialStartedAt || !row.trialEndsAt) {
    return { status: 'NEVER_STARTED', endsAt: null, daysRemaining: null }
  }
  const endsAt = new Date(row.trialEndsAt)
  if (now.getTime() < endsAt.getTime()) {
    const daysRemaining = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)
    return { status: 'TRIAL_ACTIVE', endsAt, daysRemaining }
  }
  if (row.conversionGraceEndsAt && now.getTime() < new Date(row.conversionGraceEndsAt).getTime()) {
    return { status: 'TRIAL_ACTIVE', endsAt, daysRemaining: 0 }
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
