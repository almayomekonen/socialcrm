import { afterEach, describe, expect, it, vi } from 'vitest'

/** Upper-bound estimates, policy configuration and the never-blocking contract. Pure: no DB, no provider. */
const hang = vi.hoisted(() => ({ reserve: vi.fn(() => new Promise(() => undefined)), settle: vi.fn() }))
vi.mock('@/db/aiBudget', () => ({ reserveShadow: hang.reserve, settleShadow: hang.settle }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))

import { estimateAgentCall, estimateStructuredRequest, estimateTranscription } from '@/lib/ai/budget/estimate'
import { DEFAULT_BUDGET_POLICY, budgetPolicyFor, isAiBudgetShadowEnabled } from '@/lib/ai/budget/policy'
import { newCallId, settleShadowAfter, startShadow } from '@/lib/ai/budget/shadow'

afterEach(() => {
  delete process.env.AI_BUDGET_SHADOW
  delete process.env.AI_BUDGET_POLICY
})

describe('estimates are upper bounds, labelled honestly', () => {
  it('structured request: UTF-8 bytes at the worst input rate + max output', () => {
    const e = estimateStructuredRequest({
      model: 'gpt-5.6-sol',
      system: 'abc',
      user: 'שלום',
      maxOutputTokens: 2_500,
      unboundedReserveUsd: 0.1,
    })
    // bytes = 3 + 8 = 11, priced at max(input $4, cache write $5) = $5; 2,500 × $20
    expect(e).toEqual({
      usd: Math.round(((11 * 5 + 2_500 * 20) / 1e6) * 1e6) / 1e6,
      basis: 'bounded',
      incomplete: false,
      note: null,
    })
  })

  it('images make it partial; an unpriced model makes it unbounded (the policy reserve)', () => {
    expect(
      estimateStructuredRequest({
        model: 'claude-sonnet-4-6',
        system: 's',
        user: 'u',
        imageCount: 1,
        maxOutputTokens: 10,
        unboundedReserveUsd: 0.1,
      }),
    ).toMatchObject({ basis: 'partial', incomplete: true })
    expect(
      estimateStructuredRequest({ model: 'gpt-5.6', system: 's', user: 'u', maxOutputTokens: 10, unboundedReserveUsd: 0.3 }),
    ).toEqual({ usd: 0.3, basis: 'unbounded', incomplete: true, note: 'unpriced_model' })
  })

  it('Agent call: steps × known input + outputs + search ceiling, always partial', () => {
    const e = estimateAgentCall({
      model: 'gpt-5.6-sol',
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      maxSteps: 3,
      maxOutputTokens: 100,
      maxSearchCalls: 2,
      unboundedReserveUsd: 0.1,
    })
    expect(e.basis).toBe('partial')
    expect(e.usd).toBeGreaterThan((3 * 100 * 20) / 1e6 + 0.02)
  })

  it('transcription is bounded by the recording cap', () => {
    expect(estimateTranscription(120_000)).toMatchObject({ usd: 0.012, basis: 'bounded' })
  })
})

describe('policy', () => {
  it('defaults: shadow off; no limits; local version', () => {
    expect(isAiBudgetShadowEnabled()).toBe(false)
    const p = budgetPolicyFor(103)
    expect(p.version).toBe('local-default-v1')
    expect([p.agencyDailyUsd, p.globalDailyUsd, p.perRequestMaxUsd]).toEqual([null, null, null])
  })

  it('only the exact value 1 turns shadow on', () => {
    process.env.AI_BUDGET_SHADOW = 'true'
    expect(isAiBudgetShadowEnabled()).toBe(false)
    process.env.AI_BUDGET_SHADOW = '1'
    expect(isAiBudgetShadowEnabled()).toBe(true)
  })

  it('JSON config, per-agency overrides isolated to that agency, bad values ignored', () => {
    process.env.AI_BUDGET_POLICY = JSON.stringify({
      version: 'v7',
      agencyDailyUsd: 5,
      globalDailyUsd: -1,
      agencyOverrides: { '103': { agencyDailyUsd: 1 } },
    })
    expect(budgetPolicyFor(103)).toMatchObject({ agencyDailyUsd: 1, version: 'v7+agency103', globalDailyUsd: null })
    expect(budgetPolicyFor(158)).toMatchObject({ agencyDailyUsd: 5, version: 'v7' })
  })

  it('invalid JSON falls back to the default and never throws', () => {
    process.env.AI_BUDGET_POLICY = '{nope'
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(budgetPolicyFor(1).version).toBe(DEFAULT_BUDGET_POLICY.version)
    err.mockRestore()
  })
})

describe('never blocks', () => {
  it('a reservation that never completes does not hold the request: settle returns within its cap', async () => {
    process.env.AI_BUDGET_SHADOW = '1'
    const h = startShadow({
      callId: newCallId(),
      agencyId: 1,
      feature: 'f',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      estimate: () => ({ usd: 0.01, basis: 'bounded', incomplete: false, note: null }),
    })
    const t0 = Date.now()
    await settleShadowAfter(h, { outcome: 'success', usage: null, models: { requested: 'gpt-5.6-sol' } })
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(hang.settle).not.toHaveBeenCalled()
  })

  it('flag off: no reservation is even attempted', async () => {
    hang.reserve.mockClear()
    expect(
      await startShadow({
        callId: 'x',
        feature: 'f',
        provider: 'p',
        model: 'm',
        estimate: () => ({ usd: 0, basis: 'bounded', incomplete: false, note: null }),
      }),
    ).toBeNull()
    expect(hang.reserve).not.toHaveBeenCalled()
  })
})
