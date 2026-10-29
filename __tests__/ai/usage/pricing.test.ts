import { describe, expect, it } from 'vitest'
import { PRICE_VERSION, priceFor, priceUsage } from '@/lib/ai/usage/pricing'
import { callsFromSteps, errorCodeOf, usageFromSdk } from '@/lib/ai/usage/record'

/** Ledger pricing and SDK normalisation. Pure: no DB, no provider. */

const full = (over: Record<string, number | null> = {}) => ({
  inputTokens: 10_000,
  uncachedInputTokens: 2_000,
  cachedInputTokens: 6_000,
  cacheWriteTokens: 2_000,
  outputTokens: 500,
  ...over,
})

describe('priceUsage', () => {
  it('gpt-5.6-sol: every token category at its own official rate', () => {
    const v = priceUsage({ requested: 'gpt-5.6', response: 'gpt-5.6-sol' }, full())
    // 2,000×4 + 6,000×0.4 + 2,000×5 + 500×20 = 30,400 per 1M
    expect(v).toEqual({ costUsd: 0.0304, costBasis: 'reported_usage', costNote: null, priceVersion: PRICE_VERSION })
  })

  it('long context (> 272K input) uses the long-context rates', () => {
    const v = priceUsage(
      { requested: 'gpt-5.6-sol' },
      full({ inputTokens: 300_000, uncachedInputTokens: 300_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }),
    )
    expect(v.costUsd).toBeCloseTo(2.4, 6) // 300K × $8
  })

  it('an unlisted model is unknown — plain gpt-5.6 is NOT guessed', () => {
    expect(priceUsage({ requested: 'gpt-5.6' }, full())).toMatchObject({
      costUsd: null,
      costBasis: 'unknown',
      costNote: 'unpriced_model',
    })
  })

  it('missing usage is unknown, never zero', () => {
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, null)).toMatchObject({
      costUsd: null,
      costBasis: 'unknown',
      costNote: 'usage_missing',
    })
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, full({ outputTokens: null }))).toMatchObject({ costBasis: 'unknown' })
  })

  it('no input split from the provider: charged at the full rate and marked estimated', () => {
    const v = priceUsage(
      { requested: 'claude-sonnet-4-6' },
      { inputTokens: 1_000, uncachedInputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 100 },
    )
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'input_split_missing' })
    expect(v.costUsd).toBeCloseTo((1_000 * 3 + 100 * 15) / 1e6, 9)
  })

  it('cache writes on a model without a write price are estimated at the input rate', () => {
    const v = priceUsage({ requested: 'gpt-4.1-mini' }, full())
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_unpriced' })
  })

  it('hosted web-search calls are added at $10 per 1,000', () => {
    const base = priceUsage({ requested: 'gpt-5.6-sol' }, full())
    const withSearch = priceUsage({ requested: 'gpt-5.6-sol' }, full(), { webSearchCalls: 3 })
    expect((withSearch.costUsd ?? 0) - (base.costUsd ?? 0)).toBeCloseTo(0.03, 9)
  })

  it('dated snapshot ids resolve to their base model', () => {
    expect(priceFor('gpt-4.1-mini-2025-04-14')?.id).toBe('gpt-4.1-mini')
    expect(priceFor('claude-sonnet-4-6-20260101')?.id).toBe('claude-sonnet-4-6')
    expect(priceFor('gpt-image-1')).toBeNull()
  })
})

describe('usageFromSdk / callsFromSteps / errorCodeOf', () => {
  it('maps every SDK token category; absent stays null', () => {
    expect(usageFromSdk({ inputTokens: 10, outputTokens: 2 })).toEqual({
      inputTokens: 10,
      uncachedInputTokens: null,
      cachedInputTokens: null,
      cacheWriteTokens: null,
      outputTokens: 2,
      reasoningTokens: null,
    })
    expect(usageFromSdk(undefined)).toBeNull()
    expect(usageFromSdk({})).toBeNull()
  })

  it('one call per Agent step, with that step’s request id, model and hosted searches', () => {
    const calls = callsFromSteps(
      [
        {
          usage: { inputTokens: 5, outputTokens: 1 },
          response: { id: 'a', modelId: 'gpt-5.6-sol' },
          finishReason: 'tool-calls',
          toolCalls: [{ providerExecuted: true }, { providerExecuted: false }],
        },
        { usage: { inputTokens: 7, outputTokens: 3 }, response: { id: 'b', modelId: 'gpt-5.6-sol' }, finishReason: 'stop' },
      ],
      { invocationId: 'inv', feature: 'agent.investigate', provider: 'openai', requestedModel: 'gpt-5.6' },
    )
    expect(calls.map((c) => [c.stepIndex, c.providerRequestId, c.webSearchCalls, c.usage?.inputTokens])).toEqual([
      [0, 'a', 1, 5],
      [1, 'b', 0, 7],
    ])
  })

  it('error codes carry the error name only, never a provider message', () => {
    expect(errorCodeOf(Object.assign(new Error('secret sk-xyz in message'), { name: 'AI_APICallError' }))).toBe('AI_APICallError')
    expect(errorCodeOf({ name: 'has spaces and sk-key' })).toBe('error')
  })
})
