import { describe, expect, it } from 'vitest'
import {
  MODEL_PRICING_ALIASES,
  PRICE_VERSION,
  directPriceFor,
  maxCacheWriteRate,
  priceFor,
  priceUsage,
  resolvePrice,
} from '@/lib/ai/usage/pricing'
import {
  callsFromSteps,
  combineVerdicts,
  errorCodeOf,
  serviceTierFrom,
  usageFromSdk,
  verdictForCall,
} from '@/lib/ai/usage/record'

/** Ledger pricing and SDK normalisation. Pure: no DB, no provider. */

const STD = { serviceTier: 'default' }
const usage = (over: Record<string, number | null> = {}) => ({
  inputTokens: 10_000,
  uncachedInputTokens: 10_000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 500,
  ...over,
})

describe('the documented gpt-5.6 → gpt-5.6-sol alias (cost estimation only)', () => {
  it('is documented with its source', () => {
    expect(MODEL_PRICING_ALIASES['gpt-5.6']).toEqual({
      target: 'gpt-5.6-sol',
      source: 'https://developers.openai.com/api/docs/models/gpt-5.6',
    })
  })

  it('prices plain gpt-5.6 at the gpt-5.6-sol schedule, as an ESTIMATE, and says so', () => {
    expect(priceFor('gpt-5.6')).toMatchObject({ id: 'gpt-5.6-sol', aliasOf: 'gpt-5.6' })
    expect(directPriceFor('gpt-5.6')).toBeNull()
    const v = priceUsage({ requested: 'gpt-5.6' }, usage(), STD)
    expect(v).toEqual({
      costUsd: (10_000 * 4 + 500 * 20) / 1e6,
      costBasis: 'estimated',
      costNote: 'priced_as_alias:gpt-5.6-sol',
      priceVersion: PRICE_VERSION,
    })
  })

  it('the provider-reported model wins over the alias', () => {
    expect(priceUsage({ requested: 'gpt-5.6', response: 'gpt-5.6-sol' }, usage(), STD).costNote).toBeNull()
    expect(priceUsage({ requested: 'gpt-5.6', response: 'gpt-5.6-luna' }, usage(), STD).costUsd).toBeCloseTo(
      (10_000 * 0.2 + 500 * 1.2) / 1e6,
      9,
    )
  })

  it('exact matches are not affected, and dated snapshots still resolve', () => {
    expect(priceFor('gpt-5.6-sol')).toMatchObject({ id: 'gpt-5.6-sol' })
    expect(priceFor('gpt-5.6-sol')?.aliasOf).toBeUndefined()
    expect(priceFor('gpt-4.1-mini-2025-04-14')?.id).toBe('gpt-4.1-mini')
    expect(priceFor('claude-sonnet-4-6-20260101')?.id).toBe('claude-sonnet-4-6')
  })
})

describe('alias precedence: direct reported → direct requested → alias', () => {
  it('a direct price for the reported model wins', () => {
    expect(resolvePrice({ requested: 'gpt-5.6', response: 'gpt-5.6-luna' })).toMatchObject({
      id: 'gpt-5.6-luna',
      via: 'response',
    })
  })

  it('a direct price for the requested model beats an alias on the reported one', () => {
    expect(resolvePrice({ requested: 'gpt-5.6-sol', response: 'gpt-5.6' })).toMatchObject({ id: 'gpt-5.6-sol', via: 'requested' })
    expect(resolvePrice({ requested: 'gpt-4.1-mini', response: 'gpt-5.6' })).toMatchObject({
      id: 'gpt-4.1-mini',
      via: 'requested',
    })
  })

  it('the alias applies only when neither has a direct price — reported first', () => {
    expect(resolvePrice({ requested: 'gpt-5.6', response: null })).toMatchObject({ via: 'requested_alias', aliasOf: 'gpt-5.6' })
    expect(resolvePrice({ requested: 'gpt-9-preview', response: 'gpt-5.6' })).toMatchObject({ via: 'response_alias' })
  })

  it('an unknown REPORTED model: priced as the requested model, flagged, estimated', () => {
    const direct = priceUsage({ requested: 'gpt-4.1-mini', response: 'gpt-9-preview' }, usage(), STD)
    expect(direct).toMatchObject({ costBasis: 'estimated', costNote: 'response_model_unpriced' })
    const viaAlias = priceUsage({ requested: 'gpt-5.6', response: 'gpt-9-preview' }, usage(), STD)
    expect(viaAlias).toMatchObject({ costBasis: 'estimated', costNote: 'priced_as_alias:gpt-5.6-sol,response_model_unpriced' })
  })

  it('a reported model that is not given is not "unpriced"', () => {
    expect(priceUsage({ requested: 'gpt-4.1-mini', response: null }, usage(), STD)).toMatchObject({
      costBasis: 'reported_usage',
      costNote: null,
    })
  })

  it('dated ids are never implicitly aliased', () => {
    expect(priceFor('gpt-5.6-2026-09-01')).toBeNull()
    expect(priceUsage({ requested: 'gpt-5.6-2026-09-01' }, usage(), STD)).toMatchObject({
      costBasis: 'unknown',
      costNote: 'unpriced_model',
    })
  })

  it('future alias collisions: direct prices still win, the reported alias beats the requested one', () => {
    const table = MODEL_PRICING_ALIASES as Record<string, { target: string; source: string }>
    table['gpt-x'] = { target: 'gpt-5.6-terra', source: 'test' }
    table['gpt-5.6-luna'] = { target: 'gpt-5.6-sol', source: 'test' } // an alias key that also has a direct price
    try {
      expect(priceFor('gpt-5.6-luna')).toMatchObject({ id: 'gpt-5.6-luna' })
      expect(priceFor('gpt-5.6-luna')?.aliasOf).toBeUndefined()
      expect(resolvePrice({ requested: 'gpt-5.6', response: 'gpt-x' })).toMatchObject({
        id: 'gpt-5.6-terra',
        via: 'response_alias',
      })
      expect(resolvePrice({ requested: 'gpt-5.6-luna', response: 'gpt-x' })).toMatchObject({
        id: 'gpt-5.6-luna',
        via: 'requested',
      })
    } finally {
      delete table['gpt-x']
      delete table['gpt-5.6-luna']
    }
  })
})

describe('unreported cache-write counts (the OpenAI SDK never reports one)', () => {
  // What @ai-sdk/openai 3.0.x yields: total, noCache = total − cached, cacheWrite undefined.
  const openai = (input: number, cached: number) =>
    usage({ inputTokens: input, uncachedInputTokens: input - cached, cachedInputTokens: cached, cacheWriteTokens: null })

  it('the first, cache-creating request (no reads): estimated, NOT reported, priced at the input rate', () => {
    const v = priceUsage({ requested: 'gpt-5.6-sol' }, openai(10_000, 0), STD)
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_unreported' })
    // Uncached tokens are not reclassified as writes: 10,000 × $4 (point estimate; writes could cost up to $10).
    expect(v.costUsd).toBeCloseTo((10_000 * 4 + 500 * 20) / 1e6, 9)
  })

  it('a later request with cache reads: still estimated', () => {
    const v = priceUsage({ requested: 'gpt-5.6-sol' }, openai(10_000, 8_000), STD)
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_unreported' })
    expect(v.costUsd).toBeCloseTo((2_000 * 4 + 8_000 * 0.4 + 500 * 20) / 1e6, 9)
  })

  it('every input token was a cache read: a missing write count cannot change the cost', () => {
    expect(priceUsage({ requested: 'gpt-5.6-sol' }, openai(10_000, 10_000), STD)).toMatchObject({
      costBasis: 'reported_usage',
      costNote: null,
    })
  })

  it('no cache metadata at all: estimated for both reasons', () => {
    const v = priceUsage(
      { requested: 'gpt-5.6-sol' },
      { inputTokens: 1_000, uncachedInputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 10 },
      STD,
    )
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'input_split_missing,cache_write_unreported' })
  })

  it('models without separately billed writes are unaffected', () => {
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, openai(10_000, 0), STD)).toMatchObject({ costBasis: 'reported_usage' })
  })
})

describe('cache pricing', () => {
  it('cache reads at the cached rate; with no writes the result is reported', () => {
    const v = priceUsage({ requested: 'gpt-5.6-sol' }, usage({ uncachedInputTokens: 2_000, cachedInputTokens: 8_000 }), STD)
    expect(v).toMatchObject({ costBasis: 'reported_usage', costNote: null })
    expect(v.costUsd).toBeCloseTo((2_000 * 4 + 8_000 * 0.4 + 500 * 20) / 1e6, 9)
  })

  it('cache writes: duration not reported → the HIGHEST listed write rate, estimated', () => {
    expect(maxCacheWriteRate(priceFor('gpt-5.6-sol')!.price)).toBe(10) // 30 min $5, 12 h $10
    const v = priceUsage(
      { requested: 'gpt-5.6-sol' },
      usage({ uncachedInputTokens: 2_000, cachedInputTokens: 6_000, cacheWriteTokens: 2_000 }),
      STD,
    )
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_duration_unknown' })
    expect(v.costUsd).toBeCloseTo((2_000 * 4 + 6_000 * 0.4 + 2_000 * 10 + 500 * 20) / 1e6, 9)
  })

  it('writes billed separately but not reported (with reads) → estimated', () => {
    const v = priceUsage(
      { requested: 'gpt-5.6-sol' },
      usage({ uncachedInputTokens: 4_000, cachedInputTokens: 6_000, cacheWriteTokens: null }),
      STD,
    )
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_unreported' })
  })

  it('a model without separate write pricing: writes at the input rate, estimated', () => {
    expect(
      priceUsage({ requested: 'gpt-4.1-mini' }, usage({ uncachedInputTokens: 8_000, cacheWriteTokens: 2_000 }), STD),
    ).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_unpriced' })
  })
})

describe('long context (> 272K input tokens, the whole request)', () => {
  it('uses the long-context rates for input, cached input, writes and output', () => {
    const v = priceUsage(
      { requested: 'gpt-5.6' },
      usage({ inputTokens: 300_000, uncachedInputTokens: 300_000, outputTokens: 1_000 }),
      STD,
    )
    expect(v.costUsd).toBeCloseTo((300_000 * 8 + 1_000 * 30) / 1e6, 6)
    const w = priceUsage(
      { requested: 'gpt-5.6-sol' },
      usage({
        inputTokens: 300_000,
        uncachedInputTokens: 0,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 100_000,
        outputTokens: 0,
      }),
      STD,
    )
    expect(w.costUsd).toBeCloseTo((200_000 * 0.8 + 100_000 * 20) / 1e6, 6)
  })

  it('exactly at the threshold is still short context', () => {
    expect(
      priceUsage(
        { requested: 'gpt-5.6-sol' },
        usage({ inputTokens: 272_000, uncachedInputTokens: 272_000, outputTokens: 0 }),
        STD,
      ).costUsd,
    ).toBeCloseTo((272_000 * 4) / 1e6, 6)
  })
})

describe('missing metadata and unknown models', () => {
  it('missing usage is unknown, never zero', () => {
    expect(priceUsage({ requested: 'gpt-5.6' }, null, STD)).toMatchObject({
      costUsd: null,
      costBasis: 'unknown',
      costNote: 'usage_missing',
    })
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, usage({ outputTokens: null }), STD)).toMatchObject({ costBasis: 'unknown' })
  })

  it('billing tier not reported → estimated at Standard; a non-Standard tier → unknown', () => {
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, usage())).toMatchObject({
      costBasis: 'estimated',
      costNote: 'service_tier_unreported',
    })
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, usage(), { serviceTier: 'flex' })).toMatchObject({
      costUsd: null,
      costBasis: 'unknown',
      costNote: 'unpriced_service_tier:flex',
    })
    expect(priceUsage({ requested: 'gpt-4.1-mini' }, usage(), { serviceTier: 'priority' }).costBasis).toBe('unknown')
  })

  it('no input split → full rate, estimated', () => {
    const v = priceUsage(
      { requested: 'claude-sonnet-4-6' },
      { inputTokens: 1_000, uncachedInputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 100 },
      STD,
    )
    // Anthropic bills writes separately and none were reported: both reasons are kept.
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'input_split_missing,cache_write_unreported' })
    expect(v.costUsd).toBeCloseTo((1_000 * 3 + 100 * 15) / 1e6, 9)
  })

  it('an unlisted, un-aliased model is unknown', () => {
    expect(priceUsage({ requested: 'gpt-9-preview' }, usage(), STD)).toMatchObject({
      costUsd: null,
      costBasis: 'unknown',
      costNote: 'unpriced_model',
    })
    expect(priceFor('gpt-image-1')).toBeNull()
    expect(priceFor('gpt-5.6-x')).toBeNull()
  })

  it('hosted web-search calls are added at $10 per 1,000', () => {
    const base = priceUsage({ requested: 'gpt-5.6-sol' }, usage(), STD)
    const withSearch = priceUsage({ requested: 'gpt-5.6-sol' }, usage(), { ...STD, webSearchCalls: 3 })
    expect((withSearch.costUsd ?? 0) - (base.costUsd ?? 0)).toBeCloseTo(0.03, 9)
  })
})

describe('verdictForCall / combineVerdicts (one pricing path for ledger rows and settlements)', () => {
  const call = (input: number, over: Record<string, unknown> = {}) => ({
    invocationId: 'i',
    feature: 'f',
    provider: 'openai',
    requestedModel: 'gpt-5.6',
    responseModel: 'gpt-5.6-sol',
    status: 'success' as const,
    serviceTier: 'default',
    usage: { inputTokens: input, uncachedInputTokens: input, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
    ...over,
  })

  it('each step priced on its own: 3 × 100K (300K total) stays at standard rates', () => {
    const v = combineVerdicts([call(100_000), call(100_000), call(100_000)].map(verdictForCall))
    expect(v).toMatchObject({ costBasis: 'reported_usage', costNote: null, priceVersion: PRICE_VERSION })
    expect(v.costUsd).toBeCloseTo((3 * (100_000 * 4 + 100 * 20)) / 1e6, 9)
  })

  it('one estimated step makes the total estimated; notes are kept', () => {
    const v = combineVerdicts([call(1_000), call(1_000, { serviceTier: null })].map(verdictForCall))
    expect(v).toMatchObject({ costBasis: 'estimated', costNote: 'service_tier_unreported' })
  })

  it('one unknown step makes the total unknown — never a partial sum', () => {
    const v = combineVerdicts(
      [call(1_000), call(1_000, { serviceTier: 'flex' }), call(1_000, { usage: null })].map(verdictForCall),
    )
    expect(v).toMatchObject({ costUsd: null, costBasis: 'unknown' })
    expect(v.costNote).toBe('step_cost_unknown:2/3,unpriced_service_tier:flex,usage_missing')
  })

  it('nothing to combine is unknown, not zero', () => {
    expect(combineVerdicts([])).toMatchObject({ costUsd: null, costBasis: 'unknown', costNote: 'usage_missing' })
  })
})

describe('usageFromSdk / callsFromSteps / serviceTierFrom / errorCodeOf', () => {
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

  it('reads the reported service tier from any provider metadata', () => {
    expect(serviceTierFrom({ openai: { serviceTier: 'default' } })).toBe('default')
    expect(serviceTierFrom({ anthropic: {} })).toBeNull()
    expect(serviceTierFrom(undefined)).toBeNull()
  })

  it('one call per Agent step, with that step’s request id, model, tier and hosted searches', () => {
    const calls = callsFromSteps(
      [
        {
          usage: { inputTokens: 5, outputTokens: 1 },
          response: { id: 'a', modelId: 'gpt-5.6-sol' },
          providerMetadata: { openai: { serviceTier: 'default' } },
          finishReason: 'tool-calls',
          toolCalls: [{ providerExecuted: true }, { providerExecuted: false }],
        },
        { usage: { inputTokens: 7, outputTokens: 3 }, response: { id: 'b', modelId: 'gpt-5.6-sol' }, finishReason: 'stop' },
      ],
      { invocationId: 'inv', feature: 'agent.investigate', provider: 'openai', requestedModel: 'gpt-5.6' },
    )
    expect(calls.map((c) => [c.stepIndex, c.providerRequestId, c.webSearchCalls, c.usage?.inputTokens, c.serviceTier])).toEqual([
      [0, 'a', 1, 5, 'default'],
      [1, 'b', 0, 7, null],
    ])
  })

  it('error codes carry the error name only, never a provider message', () => {
    expect(errorCodeOf(Object.assign(new Error('secret sk-xyz in message'), { name: 'AI_APICallError' }))).toBe('AI_APICallError')
    expect(errorCodeOf({ name: 'has spaces and sk-key' })).toBe('error')
  })
})
