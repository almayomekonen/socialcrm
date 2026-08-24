/**
 * lib/ai/gate — the shared AI admission gate.
 *
 * This is the sequence `runStructured` used to run inline. Extracting it only
 * counts as safe if the ORDER survives, so almost every test here is an ordering
 * test: it makes two checks fail at once and asserts which reason comes back.
 *
 * The property most at risk is the shadow gate. It runs BEFORE the forbidden
 * return, so a denied agency is still observed — a refactor that "tidies" it
 * below the denial would keep every other test green while silently blinding the
 * telemetry that exists to find exactly those divergences. Nothing pinned that
 * before this file.
 *
 * Only infra is mocked. The REAL resolveAiAccess and trial state machine run
 * (via @/db/trial), so fail-open is genuinely exercised rather than stubbed, and
 * counting getAgencyTrial calls proves whether the entitlement read happened at
 * all — which is how "allowlist precedes entitlement" is observable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const flags = { enabled: true, allowlisted: true, providers: true }
const trial = { row: undefined as unknown, throws: false, calls: 0 }
const spend = { value: 0 }
const chainValue = { current: [{ provider: 'anthropic', modelId: 'm-1', model: {} }] as unknown[] }
const shadowSpy = vi.fn()

vi.mock('@/lib/ai/flags', () => ({
  isAiEnabled: () => flags.enabled,
  isAgencyAllowlisted: (id: number | null | undefined) => Boolean(id) && flags.allowlisted,
  hasAnyProviderConfigured: () => flags.providers,
}))
vi.mock('@/lib/ai/env', () => ({ getAiEnv: () => ({ dailyUsdCap: 20 }) }))
vi.mock('@/lib/entitlements', () => ({ evaluateShadowGate: (i: unknown) => { shadowSpy(i); return Promise.resolve() } }))
vi.mock('@/lib/ai/router/spend', () => ({
  getDailySpend: () => spend.value,
  addDailySpend: vi.fn(),
  _resetDailySpendForTests: vi.fn(),
}))
vi.mock('@/lib/ai/providers', () => ({ getProviderChain: () => chainValue.current }))
vi.mock('@/lib/ai/tasks', () => ({
  getTaskConfig: () => ({ role: 'volume', maxOutputTokens: 512, timeoutMs: 10_000, retryOnSameProvider: 1 }),
  estimateCostUsd: () => 0,
}))
vi.mock('@/db/trial', () => ({
  getAgencyTrial: (id: number) => {
    trial.calls += 1
    void id
    return trial.throws ? Promise.reject(new Error('db down')) : Promise.resolve(trial.row)
  },
}))

import { admitAiRun } from '@/lib/ai/gate'

const DAY = 86_400_000
const NOW = Date.now()
const ROWS = {
  PAID: { plan: 'pro', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
  TRIAL_EXPIRED: { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - 8 * DAY), trialEndsAt: new Date(NOW - DAY) },
  NEVER_STARTED: { plan: 'free', trialExempt: false, trialStartedAt: null, trialEndsAt: null },
}

const admit = (over: Record<string, unknown> = {}) =>
  admitAiRun({ kind: 'lead.askQuestion', agencyId: 100, ...over })

beforeEach(() => {
  flags.enabled = true
  flags.allowlisted = true
  flags.providers = true
  trial.row = ROWS.PAID
  trial.throws = false
  trial.calls = 0
  spend.value = 0
  chainValue.current = [{ provider: 'anthropic', modelId: 'm-1', model: {} }]
  shadowSpy.mockClear()
})

describe('step 1 — isAiEnabled short-circuits everything', () => {
  it('returns disabled and consults nothing else', async () => {
    flags.enabled = false
    trial.row = ROWS.TRIAL_EXPIRED
    expect(await admit()).toEqual({ ok: false, reason: 'disabled' })
    expect(trial.calls).toBe(0)
    // The shadow gate sits below the enabled check, so a disabled system is silent.
    expect(shadowSpy).not.toHaveBeenCalled()
  })
})

describe('step 3 — the shadow gate runs BEFORE the denial', () => {
  it('observes a denied agency (this is the property a refactor most easily loses)', async () => {
    flags.allowlisted = false
    expect(await admit()).toEqual({ ok: false, reason: 'forbidden' })
    expect(shadowSpy).toHaveBeenCalledTimes(1)
    expect(shadowSpy.mock.calls[0]![0]).toMatchObject({ oldAllowed: false, agencyId: 100 })
  })

  it('observes an allowed agency too, with oldAllowed true', async () => {
    await admit()
    expect(shadowSpy).toHaveBeenCalledTimes(1)
    expect(shadowSpy.mock.calls[0]![0]).toMatchObject({ oldAllowed: true })
  })

  it('reports the surface, and the bypass variant when bypassing', async () => {
    await admit()
    expect(shadowSpy.mock.calls[0]![0]).toMatchObject({ surface: 'router.runStructured' })

    shadowSpy.mockClear()
    await admit({ bypassAllowlist: true })
    expect(shadowSpy.mock.calls[0]![0]).toMatchObject({ surface: 'router.runStructured.bypass', oldAllowed: true })
  })

  it('forwards taskKind, role and bypassAllowlist for the divergence record', async () => {
    await admit({ roleOverride: 'heavy', copilotModeId: 'smart' })
    expect(shadowSpy.mock.calls[0]![0]).toMatchObject({
      taskKind: 'lead.askQuestion',
      role: 'heavy',
      copilotModeId: 'smart',
      bypassAllowlist: false,
    })
  })
})

describe('step 4/5 — allowlist precedes entitlement', () => {
  it('a non-allowlisted agency is forbidden and its trial is never read', async () => {
    flags.allowlisted = false
    trial.row = ROWS.TRIAL_EXPIRED
    expect(await admit()).toEqual({ ok: false, reason: 'forbidden' })
    expect(trial.calls).toBe(0)
  })

  it('denies with the entitlement reason even when providers are also missing', async () => {
    // Pins ordering: entitlement (5) is evaluated before the provider check (6).
    flags.providers = false
    trial.row = ROWS.TRIAL_EXPIRED
    expect(await admit()).toEqual({ ok: false, reason: 'subscription-required' })
  })

  it('NEVER_STARTED is a distinct typed reason', async () => {
    trial.row = ROWS.NEVER_STARTED
    expect(await admit()).toEqual({ ok: false, reason: 'trial-not-started' })
  })

  it('skips entitlement when there is no agencyId', async () => {
    trial.row = ROWS.TRIAL_EXPIRED
    const res = await admit({ agencyId: null })
    expect(res).toEqual({ ok: false, reason: 'forbidden' }) // no agency ⇒ not allowlisted
    expect(trial.calls).toBe(0)
  })
})

describe('bypassAllowlist skips entitlement ONLY', () => {
  it('skips the entitlement read', async () => {
    flags.allowlisted = false
    trial.row = ROWS.TRIAL_EXPIRED
    const res = await admit({ bypassAllowlist: true })
    expect(res).toMatchObject({ ok: true })
    expect(trial.calls).toBe(0)
  })

  it('does NOT skip the provider-configured check', async () => {
    flags.allowlisted = false
    flags.providers = false
    expect(await admit({ bypassAllowlist: true })).toEqual({ ok: false, reason: 'no-providers' })
  })

  it('does NOT skip the daily spend cap', async () => {
    flags.allowlisted = false
    spend.value = 20
    expect(await admit({ bypassAllowlist: true })).toEqual({ ok: false, reason: 'over-quota' })
  })
})

describe('steps 6–7 — providers configured, then the spend cap', () => {
  it('an unconfigured provider set wins over an exceeded cap', async () => {
    flags.providers = false
    spend.value = 999
    expect(await admit()).toEqual({ ok: false, reason: 'no-providers' })
  })

  it('denies at the cap boundary (>=, not >)', async () => {
    spend.value = 20
    expect(await admit()).toEqual({ ok: false, reason: 'over-quota' })
  })

  it('admits just under the cap', async () => {
    spend.value = 19.99
    expect(await admit()).toMatchObject({ ok: true })
  })

  it('skips the cap entirely without an agencyId', async () => {
    spend.value = 999
    expect(await admit({ agencyId: null, bypassAllowlist: true })).toMatchObject({ ok: true })
  })

  it('the cap wins over an empty provider chain', async () => {
    // Pins ordering: spend cap (7) is evaluated before chain resolution (9).
    spend.value = 20
    chainValue.current = []
    expect(await admit()).toEqual({ ok: false, reason: 'over-quota' })
  })
})

describe('steps 8–9 — task config, effective role, provider chain', () => {
  it('an empty chain is no-providers', async () => {
    chainValue.current = []
    expect(await admit()).toEqual({ ok: false, reason: 'no-providers' })
  })

  it('returns cfg, effectiveRole and chain on success', async () => {
    const res = await admit()
    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('unreachable')
    expect(res.cfg).toMatchObject({ role: 'volume', maxOutputTokens: 512 })
    expect(res.effectiveRole).toBe('volume')
    expect(res.chain).toHaveLength(1)
  })

  it('roleOverride wins over the task config role', async () => {
    const res = await admit({ roleOverride: 'heavy' })
    if (res.ok !== true) throw new Error('unreachable')
    expect(res.effectiveRole).toBe('heavy')
  })
})

describe('production safety', () => {
  it('a trial read failure does NOT deny (fail open)', async () => {
    trial.throws = true
    expect(await admit()).toMatchObject({ ok: true })
  })

  it('admission failures never carry latencyMs', async () => {
    const cases: Array<[() => void, string]> = [
      [() => { flags.enabled = false }, 'disabled'],
      [() => { flags.allowlisted = false }, 'forbidden'],
      [() => { trial.row = ROWS.TRIAL_EXPIRED }, 'subscription-required'],
      [() => { flags.providers = false }, 'no-providers'],
      [() => { spend.value = 20 }, 'over-quota'],
    ]
    for (const [setup, reason] of cases) {
      flags.enabled = true; flags.allowlisted = true; flags.providers = true
      trial.row = ROWS.PAID; spend.value = 0
      setup()
      const res = await admit()
      expect(res).toEqual({ ok: false, reason })
      expect(Object.keys(res)).toEqual(['ok', 'reason'])
    }
  })
})
