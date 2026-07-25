/**
 * lib/ai/access — resolveAiAccess: the AI product-access decision.
 *
 * Proves the Phase-2 authorization matrix and, critically, the production-safety
 * property: PAID/TRIAL_ACTIVE/LEGACY allow; only a CONFIRMED expired/never-started
 * trial denies; and any inability to determine state (DB read failure, missing
 * row) FAILS OPEN so a paying customer is never wrongly told "subscription
 * required". Only `getAgencyTrial` is mocked — the real trial state machine and
 * hasActiveProductAccess run.
 *
 * Access is mode-independent (no per-mode quotas), so a single matrix over the
 * five lifecycle states covers fast/smart/advanced alike; the router test proves
 * mode-independence end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { row: undefined as unknown, throws: false }

vi.mock('@/db/trial', () => ({
  getAgencyTrial: () => (state.throws ? Promise.reject(new Error('db down')) : Promise.resolve(state.row)),
}))

import { resolveAiAccess } from '@/lib/ai/access'

const DAY = 86_400_000
const NOW = Date.now()

const ROWS = {
  PAID: { plan: 'pro', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
  LEGACY: { plan: 'free', trialExempt: true, trialStartedAt: null, trialEndsAt: null },
  TRIAL_ACTIVE: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - DAY), trialEndsAt: new Date(NOW + 3 * DAY) },
  TRIAL_EXPIRED: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - 8 * DAY), trialEndsAt: new Date(NOW - DAY) },
  NEVER_STARTED: { plan: 'free', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
}

beforeEach(() => {
  state.row = undefined
  state.throws = false
})

describe('resolveAiAccess — allow full-access states', () => {
  it('PAID → allowed', async () => {
    state.row = ROWS.PAID
    expect(await resolveAiAccess(1)).toEqual({ allowed: true })
  })

  it('TRIAL_ACTIVE → allowed (trial is genuinely Pro; plan is still free)', async () => {
    state.row = ROWS.TRIAL_ACTIVE
    expect(await resolveAiAccess(1)).toEqual({ allowed: true })
  })

  it('LEGACY → allowed', async () => {
    state.row = ROWS.LEGACY
    expect(await resolveAiAccess(1)).toEqual({ allowed: true })
  })
})

describe('resolveAiAccess — deny with typed business reasons', () => {
  it('TRIAL_EXPIRED → subscription-required', async () => {
    state.row = ROWS.TRIAL_EXPIRED
    expect(await resolveAiAccess(1)).toEqual({ allowed: false, reason: 'subscription-required' })
  })

  it('NEVER_STARTED → trial-not-started (distinct from expired)', async () => {
    state.row = ROWS.NEVER_STARTED
    expect(await resolveAiAccess(1)).toEqual({ allowed: false, reason: 'trial-not-started' })
  })
})

describe('resolveAiAccess — FAILS OPEN on uncertainty (production safety)', () => {
  it('DB read failure → allowed (never deny a paying customer on infra error)', async () => {
    state.throws = true
    expect(await resolveAiAccess(1)).toEqual({ allowed: true })
  })

  it('missing agency row → allowed (mirrors layout gate default)', async () => {
    state.row = undefined
    expect(await resolveAiAccess(999)).toEqual({ allowed: true })
  })
})
