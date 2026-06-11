/**
 * lib/trial — pure state-derivation tests. No DB, no mocks: getTrialState
 * imports nothing but its own module, and these tests pin the precedence
 * order (PAID → LEGACY → NEVER_STARTED → TRIAL_ACTIVE → TRIAL_EXPIRED),
 * every boundary, and the degenerate null combinations.
 */
import { describe, it, expect } from 'vitest'
import { getTrialState, type TrialRow } from '@/lib/trial'

const NOW = new Date('2026-06-11T12:00:00Z')
const base: TrialRow = {
  plan: 'free',
  trialExempt: false,
  trialStartedAt: null,
  trialEndsAt: null,
}
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000)

describe('precedence order', () => {
  it('PAID wins over everything — pro + exempt + expired timestamps', () => {
    const state = getTrialState(
      { plan: 'pro', trialExempt: true, trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-32) },
      NOW,
    )
    expect(state).toEqual({ status: 'PAID', endsAt: null, daysRemaining: null })
  })

  it('PAID wins for a non-exempt pro agency whose trial expired (paid-after-trial)', () => {
    const state = getTrialState(
      { plan: 'pro', trialExempt: false, trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-32) },
      NOW,
    )
    expect(state.status).toBe('PAID')
  })

  it('PAID wins for a pro agency mid-trial (upgraded during trial)', () => {
    const state = getTrialState(
      { plan: 'pro', trialExempt: false, trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(144) },
      NOW,
    )
    expect(state.status).toBe('PAID')
  })

  it('LEGACY wins over ACTIVE-looking timestamps on an exempt agency', () => {
    const state = getTrialState(
      { ...base, trialExempt: true, trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(144) },
      NOW,
    )
    expect(state).toEqual({ status: 'LEGACY', endsAt: null, daysRemaining: null })
  })

  it('LEGACY wins over EXPIRED-looking timestamps on an exempt agency', () => {
    const state = getTrialState(
      { ...base, trialExempt: true, trialStartedAt: hoursFromNow(-200), trialEndsAt: hoursFromNow(-32) },
      NOW,
    )
    expect(state.status).toBe('LEGACY')
  })
})

describe('the five states', () => {
  it('LEGACY: exempt, no timestamps', () => {
    expect(getTrialState({ ...base, trialExempt: true }, NOW).status).toBe('LEGACY')
  })

  it('NEVER_STARTED: both timestamps null', () => {
    expect(getTrialState(base, NOW)).toEqual({ status: 'NEVER_STARTED', endsAt: null, daysRemaining: null })
  })

  it('TRIAL_ACTIVE: now < endsAt', () => {
    const state = getTrialState(
      { ...base, trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(144) },
      NOW,
    )
    expect(state.status).toBe('TRIAL_ACTIVE')
    expect(state.endsAt).toEqual(hoursFromNow(144))
  })

  it('TRIAL_EXPIRED: now > endsAt', () => {
    const state = getTrialState(
      { ...base, trialStartedAt: hoursFromNow(-192), trialEndsAt: hoursFromNow(-24) },
      NOW,
    )
    expect(state.status).toBe('TRIAL_EXPIRED')
    expect(state.daysRemaining).toBe(0)
  })

  it('PAID: plan pro, nothing else set', () => {
    expect(getTrialState({ ...base, plan: 'pro' }, NOW).status).toBe('PAID')
  })
})

describe('timestamp boundaries', () => {
  it('1ms before endsAt is still TRIAL_ACTIVE with daysRemaining 1', () => {
    const endsAt = hoursFromNow(0)
    const state = getTrialState(
      { ...base, trialStartedAt: hoursFromNow(-168), trialEndsAt: endsAt },
      new Date(endsAt.getTime() - 1),
    )
    expect(state.status).toBe('TRIAL_ACTIVE')
    expect(state.daysRemaining).toBe(1)
  })

  it('exact boundary (now === endsAt) is TRIAL_EXPIRED with daysRemaining 0', () => {
    const state = getTrialState({ ...base, trialStartedAt: hoursFromNow(-168), trialEndsAt: NOW }, NOW)
    expect(state.status).toBe('TRIAL_EXPIRED')
    expect(state.daysRemaining).toBe(0)
  })

  it('36h left rounds up to 2 days remaining', () => {
    const state = getTrialState(
      { ...base, trialStartedAt: hoursFromNow(-132), trialEndsAt: hoursFromNow(36) },
      NOW,
    )
    expect(state.daysRemaining).toBe(2)
  })

  it('a full fresh trial reports 7 days remaining', () => {
    const state = getTrialState({ ...base, trialStartedAt: NOW, trialEndsAt: hoursFromNow(168) }, NOW)
    expect(state.daysRemaining).toBe(7)
  })
})

describe('invalid / null combinations', () => {
  it('trialStartedAt set but trialEndsAt null → NEVER_STARTED (degenerate, fail-safe)', () => {
    const state = getTrialState({ ...base, trialStartedAt: hoursFromNow(-24), trialEndsAt: null }, NOW)
    expect(state.status).toBe('NEVER_STARTED')
  })

  it('trialEndsAt set but trialStartedAt null → NEVER_STARTED (degenerate, fail-safe)', () => {
    const state = getTrialState({ ...base, trialStartedAt: null, trialEndsAt: hoursFromNow(144) }, NOW)
    expect(state.status).toBe('NEVER_STARTED')
  })

  it('accepts ISO-string timestamps (pg driver may return strings)', () => {
    const state = getTrialState(
      { ...base, trialStartedAt: hoursFromNow(-1).toISOString(), trialEndsAt: hoursFromNow(167).toISOString() },
      NOW,
    )
    expect(state.status).toBe('TRIAL_ACTIVE')
    expect(state.daysRemaining).toBe(7)
  })
})

describe('purity', () => {
  it('is deterministic and does not mutate its input', () => {
    const row: TrialRow = { ...base, trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(144) }
    const snapshot = JSON.parse(JSON.stringify(row))
    const first = getTrialState(row, NOW)
    const second = getTrialState(row, NOW)
    expect(first).toEqual(second)
    expect(JSON.parse(JSON.stringify(row))).toEqual(snapshot)
  })
})
