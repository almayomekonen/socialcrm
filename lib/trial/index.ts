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
