/**
 * lib/ai/router — Phase-2 product-access gate wiring inside runStructured.
 *
 * Proves the gate's ORDER and SAFETY end-to-end with the REAL resolveAiAccess +
 * trial state machine; only infra is mocked (flags/env/shadow/getAgencyTrial).
 * We set hasAnyProviderConfigured() = false so an allowed request returns
 * 'no-providers' right AFTER the entitlement gate — a robust, provider-free way
 * to assert "passed the gate" without mocking the SDK.
 *
 * Covered: PAID/TRIAL_ACTIVE/LEGACY pass; TRIAL_EXPIRED → subscription-required;
 * NEVER_STARTED → trial-not-started; mode-independence; allowlist runs BEFORE
 * entitlement (non-allowlisted → forbidden, trial never read); bypassAllowlist
 * skips entitlement; AI disabled short-circuits first; and a trial read failure
 * FAILS OPEN (paying customer never denied on infra error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const flags = { enabled: true, allowlisted: true, providers: false }
const trial = { row: undefined as unknown, throws: false, calls: 0 }

vi.mock('@/lib/ai/flags', () => ({
  isAiEnabled: () => flags.enabled,
  isAgencyAllowlisted: () => flags.allowlisted,
  hasAnyProviderConfigured: () => flags.providers,
}))
vi.mock('@/lib/ai/env', () => ({ getAiEnv: () => ({ dailyUsdCap: 20 }) }))
vi.mock('@/lib/entitlements', () => ({ evaluateShadowGate: () => Promise.resolve() }))
vi.mock('@/db/trial', () => ({
  getAgencyTrial: (id: number) => {
    trial.calls += 1
    void id
    return trial.throws ? Promise.reject(new Error('db down')) : Promise.resolve(trial.row)
  },
}))

import { runStructured } from '@/lib/ai/router'

const DAY = 86_400_000
const NOW = Date.now()
const ROWS = {
  PAID: { plan: 'pro', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
  LEGACY: { plan: 'free', trialExempt: true, trialStartedAt: null, trialEndsAt: null },
  TRIAL_ACTIVE: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - DAY), trialEndsAt: new Date(NOW + 3 * DAY) },
  TRIAL_EXPIRED: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - 8 * DAY), trialEndsAt: new Date(NOW - DAY) },
  NEVER_STARTED: { plan: 'free', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
}

const SCHEMA = z.object({ x: z.string() })
const call = (over: Record<string, unknown> = {}) =>
  runStructured({ kind: 'lead.askQuestion', schema: SCHEMA, system: 's', user: 'u', agencyId: 100, ...over })

beforeEach(() => {
  flags.enabled = true
  flags.allowlisted = true
  flags.providers = false
  trial.row = undefined
  trial.throws = false
  trial.calls = 0
})

describe('entitlement gate — allow (reaches no-providers past the gate)', () => {
  it.each([
    ['PAID', ROWS.PAID],
    ['TRIAL_ACTIVE', ROWS.TRIAL_ACTIVE],
    ['LEGACY', ROWS.LEGACY],
  ])('%s passes the gate', async (_name, row) => {
    trial.row = row
    const res = await call()
    expect(res).toEqual({ ok: false, reason: 'no-providers' })
    expect(trial.calls).toBe(1) // entitlement WAS consulted
  })
})

describe('entitlement gate — deny with typed reason', () => {
  it('TRIAL_EXPIRED → subscription-required', async () => {
    trial.row = ROWS.TRIAL_EXPIRED
    expect(await call()).toEqual({ ok: false, reason: 'subscription-required' })
  })

  it('NEVER_STARTED → trial-not-started', async () => {
    trial.row = ROWS.NEVER_STARTED
    expect(await call()).toEqual({ ok: false, reason: 'trial-not-started' })
  })

  it('is mode-independent: fast / smart / advanced all denied for an expired trial', async () => {
    trial.row = ROWS.TRIAL_EXPIRED
    for (const copilotModeId of ['fast', 'smart', 'advanced'] as const) {
      expect(await call({ copilotModeId })).toEqual({ ok: false, reason: 'subscription-required' })
    }
  })
})

describe('gate ordering & bypass', () => {
  it('allowlist runs BEFORE entitlement — non-allowlisted → forbidden, trial never read', async () => {
    flags.allowlisted = false
    trial.row = ROWS.TRIAL_EXPIRED
    expect(await call()).toEqual({ ok: false, reason: 'forbidden' })
    expect(trial.calls).toBe(0)
  })

  it('bypassAllowlist skips entitlement (internal/health/scripts) — trial never read', async () => {
    flags.allowlisted = false
    trial.row = ROWS.TRIAL_EXPIRED
    const res = await call({ bypassAllowlist: true })
    expect(res).toEqual({ ok: false, reason: 'no-providers' }) // passed to provider check, not denied
    expect(trial.calls).toBe(0)
  })

  it('AI disabled short-circuits before entitlement', async () => {
    flags.enabled = false
    trial.row = ROWS.TRIAL_EXPIRED
    expect(await call()).toEqual({ ok: false, reason: 'disabled' })
    expect(trial.calls).toBe(0)
  })
})

describe('production safety — fail open', () => {
  it('trial read failure does NOT deny; flow continues (paying customer protected)', async () => {
    trial.throws = true
    expect(await call()).toEqual({ ok: false, reason: 'no-providers' })
  })
})
