/**
 * Model B — canonical paid-period entitlement (Phase 1). Pure, frozen-time.
 * Encodes the approved rule: plan='pro' alone is NOT paid access; a grow prepaid
 * period is active strictly until expiresAt (0-day grace); admin/legacy/dev
 * exceptions preserved; an expired paid customer never reactivates an old trial.
 */
import { describe, it, expect } from 'vitest'
import { isPaidPeriodActive, getTrialState, hasActiveProductAccess, type TrialRow } from '@/lib/trial'

const NOW = new Date('2026-08-01T00:00:00.000Z')
const d = (s: string) => new Date(s)
const row = (r: Partial<TrialRow>): TrialRow => ({
  plan: 'free',
  trialExempt: false,
  trialStartedAt: null,
  trialEndsAt: null,
  planReason: null,
  expiresAt: null,
  ...r,
})
const access = (r: TrialRow) => hasActiveProductAccess(getTrialState(r, NOW).status)

describe('isPaidPeriodActive (canonical)', () => {
  it('1. active monthly grow → paid', () => {
    expect(isPaidPeriodActive(row({ plan: 'pro', planReason: 'grow:t1', expiresAt: d('2026-08-20') }), NOW)).toBe(true)
  })
  it('2. active annual grow → paid', () => {
    expect(isPaidPeriodActive(row({ plan: 'pro', planReason: 'grow:t2', expiresAt: d('2027-06-01') }), NOW)).toBe(true)
  })
  it('3. expired grow period → NOT paid', () => {
    expect(isPaidPeriodActive(row({ plan: 'pro', planReason: 'grow:t3', expiresAt: d('2026-07-09') }), NOW)).toBe(false)
  })
  it('4. raw plan=pro with no subscription period → NOT paid (grow source)', () => {
    expect(isPaidPeriodActive(row({ plan: 'pro', planReason: 'grow:t4', expiresAt: null }), NOW)).toBe(false)
  })
  it('5. admin grant → paid regardless of expiry (none)', () => {
    expect(isPaidPeriodActive(row({ plan: 'pro', planReason: 'admin-grant:review', expiresAt: null }), NOW)).toBe(true)
  })
  it('0-day grace: exactly at expiresAt is NOT active', () => {
    expect(isPaidPeriodActive(row({ plan: 'pro', planReason: 'grow:t', expiresAt: NOW }), NOW)).toBe(false)
  })
  it('plan=free is never paid', () => {
    expect(isPaidPeriodActive(row({ plan: 'free' }), NOW)).toBe(false)
  })
})

describe('getTrialState precedence (Model B)', () => {
  it('active grow → PAID', () => {
    expect(getTrialState(row({ plan: 'pro', planReason: 'grow:a', expiresAt: d('2026-08-20') }), NOW).status).toBe('PAID')
  })
  it('6. expired grow + trialExempt → LEGACY (agency-33 shape, keeps access)', () => {
    const r = row({ plan: 'pro', planReason: 'grow:33', expiresAt: d('2026-07-09'), trialExempt: true })
    expect(getTrialState(r, NOW).status).toBe('LEGACY')
    expect(access(r)).toBe(true)
  })
  it('5. admin grant + trialExempt, no sub → PAID (agency-90 shape)', () => {
    const r = row({ plan: 'pro', planReason: 'admin-grant:google-oauth-review', trialExempt: true })
    expect(access(r)).toBe(true)
  })
  it('8. trial active preserved', () => {
    const r = row({ plan: 'free', trialStartedAt: d('2026-07-28'), trialEndsAt: d('2026-08-04') })
    expect(getTrialState(r, NOW).status).toBe('TRIAL_ACTIVE')
  })
  it('expired grow, not exempt, expired trial → TRIAL_EXPIRED (no reactivation)', () => {
    const r = row({ plan: 'pro', planReason: 'grow:x', expiresAt: d('2026-07-09'), trialStartedAt: d('2026-06-28'), trialEndsAt: d('2026-07-05') })
    expect(getTrialState(r, NOW).status).toBe('TRIAL_EXPIRED')
    expect(access(r)).toBe(false)
  })
  it('expired grow, not exempt, never trialed → NEVER_STARTED', () => {
    const r = row({ plan: 'pro', planReason: 'grow:x', expiresAt: d('2026-07-09') })
    expect(getTrialState(r, NOW).status).toBe('NEVER_STARTED')
    expect(access(r)).toBe(false)
  })
})

describe('9. Oren (agency-69 shape) — paid through 2026-08-20', () => {
  const oren = (expiresAt: string) => row({ plan: 'pro', planReason: 'grow:9X2w', expiresAt: d(expiresAt), trialExempt: false, trialStartedAt: d('2026-06-28'), trialEndsAt: d('2026-07-05') })
  it('before expiry → PAID', () => {
    expect(getTrialState(oren('2026-08-20'), d('2026-08-19T12:00:00Z')).status).toBe('PAID')
  })
  it('after expiry → not paid, resolves to expired-trial Free', () => {
    const s = getTrialState(oren('2026-08-20'), d('2026-08-21T00:00:00Z'))
    expect(s.status).toBe('TRIAL_EXPIRED')
    expect(hasActiveProductAccess(s.status)).toBe(false)
  })
})
