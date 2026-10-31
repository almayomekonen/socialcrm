import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * AI usage ledger against a real PostgreSQL, through the REAL router: one row
 * per provider request (retries and fallbacks included), grouped under one
 * invocation and the business operation, priced only from reported usage,
 * idempotent, content-free, and never able to cause a second AI call.
 * Only the SDK call and admission are mocked; no provider is contacted.
 */
const ai = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateObject: ai.generateObject }))
vi.mock('@/lib/ai/gate', () => ({
  admitAiRun: async () => ({
    ok: true,
    effectiveRole: 'primary',
    cfg: { maxOutputTokens: 100, timeoutMs: 5_000, retryOnSameProvider: 0, providerMaxRetries: 0 },
    chain: [
      { provider: 'openai', modelId: 'gpt-5.6', model: {} },
      { provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: {} },
    ],
  }),
}))

import { db } from '@/config/db'
import { runStructured } from '@/lib/ai/router'
import { withAiOperation } from '@/lib/ai/usage/context'
import { recordProviderCalls } from '@/lib/ai/usage/record'

const SCHEMA = z.object({ x: z.string() })
const call = () => runStructured({ kind: 'inbox.autoResponse', schema: SCHEMA, system: 's', user: 'u', agencyId: 9101 })
const rows = () => db('ai_usage_events').where({ agencyId: 9101 }).orderBy(['chainIndex', 'attempt'])
const SOL_USAGE = {
  inputTokens: 107_766,
  outputTokens: 17_249,
  inputTokenDetails: { noCacheTokens: 889, cacheReadTokens: 84_536, cacheWriteTokens: 22_341 },
  outputTokenDetails: { reasoningTokens: 9_000 },
}
const ok = (over: Record<string, unknown> = {}) => ({
  object: { x: 'a' },
  usage: SOL_USAGE,
  response: { id: 'resp_abc', modelId: 'gpt-5.6-sol' },
  providerMetadata: { openai: { serviceTier: 'default' } },
  finishReason: 'stop',
  ...over,
})

beforeEach(async () => {
  process.env.AI_USAGE_LEDGER = '1'
  ai.generateObject.mockReset()
  await db('ai_usage_events').whereIn('agencyId', [9101, 9102]).del()
})
afterAll(async () => {
  delete process.env.AI_USAGE_LEDGER
  await db('ai_usage_events').whereIn('agencyId', [9101, 9102]).del()
})

describe('one row per provider request', () => {
  it('a success inside an operation: attributed, priced from reported usage, request id kept', async () => {
    ai.generateObject.mockResolvedValueOnce(ok())
    const res = await withAiOperation({ kind: 'auto_response_job', id: '77', agencyId: 9101, conversationId: 5 }, call)
    expect(res.ok).toBe(true)
    const [r] = await rows()
    expect(r).toMatchObject({
      operationKind: 'auto_response_job',
      operationId: '77',
      conversationId: '5',
      feature: 'inbox.autoResponse',
      provider: 'openai',
      requestedModel: 'gpt-5.6',
      responseModel: 'gpt-5.6-sol',
      providerRequestId: 'resp_abc',
      status: 'success',
      usageReported: true,
      inputTokens: 107_766,
      uncachedInputTokens: 889,
      cachedInputTokens: 84_536,
      cacheWriteTokens: 22_341,
      outputTokens: 17_249,
      reasoningTokens: 9_000,
      // Standard tier reported, but the cache-write DURATION is not: writes at the highest listed rate (12 h, $10).
      costBasis: 'estimated',
      costNote: 'cache_write_duration_unknown',
      priceVersion: '2026-10-30',
    })
    // 889×$4 + 84,536×$0.40 + 22,341×$10 + 17,249×$20, per 1M
    expect(Number(r.costUsd)).toBeCloseTo(0.60576, 5)
  })

  it('a fallback: two requests, one invocation; the timed-out one has UNKNOWN cost, not zero', async () => {
    ai.generateObject
      .mockRejectedValueOnce(new Error('request timeout'))
      .mockResolvedValueOnce(ok({ response: { id: 'msg_1', modelId: 'claude-sonnet-4-6' } }))
    expect((await call()).ok).toBe(true)
    const [first, second] = await rows()
    expect(first).toMatchObject({
      chainIndex: 0,
      provider: 'openai',
      status: 'timeout',
      usageReported: false,
      costUsd: null,
      costBasis: 'unknown',
      costNote: 'usage_missing',
    })
    expect(second).toMatchObject({ chainIndex: 1, provider: 'anthropic', status: 'success', costBasis: 'estimated' })
    expect(first.invocationId).toBe(second.invocationId)
    expect(first.operationKind).toBe('inbox.autoResponse') // no worker context: the request is its own operation
  })

  it('a schema failure still records the usage the provider billed', async () => {
    const err = Object.assign(new Error('No object generated: response did not match schema'), {
      name: 'AI_NoObjectGeneratedError',
      usage: SOL_USAGE,
      response: { id: 'resp_bad', modelId: 'gpt-5.6-sol' },
    })
    ai.generateObject.mockRejectedValueOnce(err).mockRejectedValueOnce(new Error('400 bad'))
    expect((await call()).ok).toBe(false)
    const [r] = await rows()
    // Usage reported, tier not (no provider metadata on the error): estimated, never dropped.
    expect(r).toMatchObject({ status: 'error', usageReported: true, costBasis: 'estimated', providerRequestId: 'resp_bad' })
  })

  it('the documented gpt-5.6 alias prices the request as gpt-5.6-sol — an estimate; requested and reported models stay separate', async () => {
    const plain = {
      inputTokens: 1_000,
      outputTokens: 100,
      inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }
    ai.generateObject.mockResolvedValueOnce(ok({ usage: plain, response: { id: 'r', modelId: 'gpt-5.6' } }))
    await call()
    const [r] = await rows()
    expect(r).toMatchObject({
      requestedModel: 'gpt-5.6',
      responseModel: 'gpt-5.6',
      costBasis: 'estimated',
      costNote: 'priced_as_alias:gpt-5.6-sol',
    })
    expect(Number(r.costUsd)).toBeCloseTo((1_000 * 4 + 100 * 20) / 1e6, 9)
  })

  it('an unlisted REPORTED model falls back to the requested model (here the alias), is kept as reported, and is flagged', async () => {
    ai.generateObject.mockResolvedValueOnce(ok({ response: { id: 'r', modelId: 'gpt-9-preview' } }))
    await call()
    const [r] = await rows()
    expect(r).toMatchObject({ responseModel: 'gpt-9-preview', costBasis: 'estimated' })
    expect(r.costNote).toContain('priced_as_alias:gpt-5.6-sol')
    expect(r.costNote).toContain('response_model_unpriced')
  })
})

describe('safety', () => {
  it('flag absent: nothing is written and the answer is unchanged', async () => {
    delete process.env.AI_USAGE_LEDGER
    ai.generateObject.mockResolvedValueOnce(ok())
    expect((await call()).ok).toBe(true)
    expect(await rows()).toHaveLength(0)
  })

  it('a ledger failure never causes a second AI call', async () => {
    ai.generateObject.mockResolvedValueOnce(ok())
    await db.raw('ALTER TABLE ai_usage_events RENAME TO ai_usage_events_hidden')
    try {
      const res = await call()
      expect(res.ok).toBe(true)
      expect(ai.generateObject).toHaveBeenCalledTimes(1)
    } finally {
      await db.raw('ALTER TABLE ai_usage_events_hidden RENAME TO ai_usage_events')
    }
  })

  it('recording the same request twice keeps one row, as a clean no-op (not a swallowed failure)', async () => {
    const one = {
      callId: 'call-dup-1',
      invocationId: 'inv-1',
      feature: 'lead.summary',
      provider: 'anthropic',
      requestedModel: 'claude-sonnet-4-6',
      status: 'success' as const,
      usage: null,
      agencyId: 9102,
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await recordProviderCalls([one])
      await recordProviderCalls([one])
      expect(await db('ai_usage_events').where({ callId: 'call-dup-1' })).toHaveLength(1)
      expect(logged).not.toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })

  it('the table holds no content columns', async () => {
    const cols = (await db('information_schema.columns')
      .where({ table_name: 'ai_usage_events' })
      .pluck('column_name')) as string[]
    for (const c of cols) expect(c).not.toMatch(/prompt|message|text|question|answer|body|phone|email|token$|secret/i)
  })
})
