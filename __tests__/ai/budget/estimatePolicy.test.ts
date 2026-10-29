import { afterEach, describe, expect, it, vi } from 'vitest'

/** Pre-request estimates and their labels, policy configuration and the never-blocking contract. Pure: no DB, no provider. */
const hang = vi.hoisted(() => ({ reserve: vi.fn(() => new Promise(() => undefined)), settle: vi.fn() }))
vi.mock('@/db/aiBudget', () => ({ reserveShadow: hang.reserve, settleShadow: hang.settle }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))

import { z } from 'zod'
import { jsonSchema, tool } from 'ai'
import { estimateAgentCall, estimateStructuredRequest, estimateTranscription } from '@/lib/ai/budget/estimate'
import { definitionBytes, schemaBytes, toolDefinitionBytes } from '@/lib/ai/budget/requestSize'
import { DEFAULT_BUDGET_POLICY, budgetPolicyFor, isAiBudgetShadowEnabled } from '@/lib/ai/budget/policy'
import { newCallId, settleShadowAfter, startShadow } from '@/lib/ai/budget/shadow'

afterEach(() => {
  delete process.env.AI_BUDGET_SHADOW
  delete process.env.AI_BUDGET_POLICY
})

describe('estimates are labelled honestly (none is a guaranteed maximum)', () => {
  it('structured request: system + user + schema bytes at the worst input rate + max output — always PARTIAL', () => {
    const e = estimateStructuredRequest({
      model: 'gpt-5.6-sol',
      system: 'abc',
      user: 'שלום',
      schemaBytes: 40,
      schemaName: 'Reply',
      maxOutputTokens: 2_500,
      unboundedReserveUsd: 0.1,
    })
    // bytes = 3 + 8 + 40 + 5 = 56, priced at max(input $4, highest cache write $10 (12 h)) = $10; 2,500 × $20.
    // The provider's own wrapping of the schema (a json tool, json_schema format, OpenAPI conversion) is not measurable.
    expect(e).toEqual({
      usd: Math.round(((56 * 10 + 2_500 * 20) / 1e6) * 1e6) / 1e6,
      basis: 'partial',
      incomplete: true,
      note: 'provider_overhead_unmeasured',
    })
  })

  it('a larger schema produces a larger estimate; an unmeasurable schema is labelled', () => {
    const base = { model: 'claude-sonnet-4-6', system: 's', user: 'u', maxOutputTokens: 100, unboundedReserveUsd: 0.1 }
    const small = estimateStructuredRequest({ ...base, schemaBytes: 100 })
    const large = estimateStructuredRequest({ ...base, schemaBytes: 20_000 })
    expect(large.usd - small.usd).toBeCloseTo((19_900 * 3.75) / 1e6, 6)
    expect(estimateStructuredRequest({ ...base, schemaBytes: null })).toMatchObject({
      basis: 'partial',
      note: 'provider_overhead_unmeasured,schema_unmeasured',
    })
  })

  it('schema and tool sizes are measured from the JSON the SDK serialises', async () => {
    const small = z.object({ a: z.string() })
    const large = z.object({ a: z.string(), b: z.array(z.object({ c: z.number(), d: z.enum(['x', 'y', 'z']) })) })
    const s = (await schemaBytes(small))!
    expect(s).toBeGreaterThan(10)
    expect((await schemaBytes(large))!).toBeGreaterThan(s)
    expect(await schemaBytes(undefined)).toBe(0)
    const tools = { lookup: tool({ description: 'Find a lead', inputSchema: small, execute: async () => 'x' }) }
    const t = (await toolDefinitionBytes(tools))!
    expect(t).toBeGreaterThan(s) // name + description + schema
    expect(await definitionBytes({ tools, schema: large })).toBe(t + (await schemaBytes(large))!)
    const unmeasurable = jsonSchema(() => {
      throw new Error('lazy schema failed')
    })
    expect(await schemaBytes(unmeasurable)).toBeNull()
  })

  it('images make it partial; an unpriced model makes it unbounded (the policy reserve)', () => {
    expect(
      estimateStructuredRequest({
        model: 'claude-sonnet-4-6',
        system: 's',
        user: 'u',
        schemaBytes: 0,
        imageCount: 1,
        maxOutputTokens: 10,
        unboundedReserveUsd: 0.1,
      }),
    ).toMatchObject({ basis: 'partial', incomplete: true, note: 'provider_overhead_unmeasured,image_input_unmeasured' })
    expect(
      estimateStructuredRequest({
        model: 'gpt-9-preview',
        system: 's',
        user: 'u',
        schemaBytes: 0,
        maxOutputTokens: 10,
        unboundedReserveUsd: 0.3,
      }),
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
    // Tool definitions and the output schema are re-sent on every step.
    const withDefs = estimateAgentCall({
      model: 'gpt-5.6-sol',
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      maxSteps: 3,
      maxOutputTokens: 100,
      maxSearchCalls: 2,
      definitionBytes: 1_000,
      unboundedReserveUsd: 0.1,
    })
    expect(withDefs.usd - e.usd).toBeCloseTo((3 * 1_000 * 10) / 1e6, 6)
    expect(
      estimateAgentCall({
        model: 'gpt-5.6-sol',
        system: 'x',
        messages: [],
        maxSteps: 1,
        maxOutputTokens: 1,
        definitionBytes: null,
        unboundedReserveUsd: 0.1,
      }).note,
    ).toContain('definitions_unmeasured')
  })

  it('transcription is priced at the recording cap but PARTIAL: the server cannot verify the real duration', () => {
    expect(estimateTranscription(120_000)).toEqual({
      usd: 0.012,
      basis: 'partial',
      incomplete: true,
      note: 'duration_unverified',
    })
    // Metadata within the cap is still unverified (it can be forged).
    expect(estimateTranscription(120_000, 30_000)).toMatchObject({
      basis: 'partial',
      note: 'duration_unverified,duration_metadata_within_cap',
    })
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
