import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Budget SHADOW through the real router: a would-deny never stops, delays or
 * changes the provider call; each attempt (retry/fallback) gets its own
 * reservation, settled honestly; the reservation shares its callId with the
 * usage-ledger row; the contact is a hash. Only the SDK and admission are mocked.
 */
const ai = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateObject: ai.generateObject }))
const chain = vi.hoisted(() => ({
  value: [
    { provider: 'openai', modelId: 'gpt-5.6-sol', model: {} },
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: {} },
  ] as { provider: string; modelId: string; model: object }[],
}))
vi.mock('@/lib/ai/gate', () => ({
  admitAiRun: async () => ({
    ok: true,
    effectiveRole: 'primary',
    cfg: { maxOutputTokens: 500, timeoutMs: 5_000, retryOnSameProvider: 0, providerMaxRetries: 0 },
    chain: chain.value,
  }),
}))

import { db } from '@/config/db'
import { runStructured } from '@/lib/ai/router'
import { withAiOperation } from '@/lib/ai/usage/context'
import { agency, cleanup, conversation } from '../../ownerWhatsappReminders/reminderFixtures'

const AGENCY = 9501
const SCHEMA = z.object({ x: z.string() })
const call = () =>
  runStructured({ kind: 'inbox.autoResponse', schema: SCHEMA, system: 'שלום', user: 'מה המחיר?', agencyId: AGENCY })
const usage = {
  inputTokens: 1_000,
  outputTokens: 100,
  inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
}
const ok = (modelId = 'gpt-5.6-sol') => ({ object: { x: 'a' }, usage, response: { id: 'r1', modelId }, finishReason: 'stop' })
const reservations = () => db('ai_budget_reservations').where({ agencyId: AGENCY }).orderBy('id')
const settled = async () => {
  for (let i = 0; i < 40; i++) {
    const open = await db('ai_budget_reservations')
      .where({ agencyId: AGENCY, state: 'reserved' })
      .count<{ count: string }>('* as count')
      .first()
    if (Number(open?.count) === 0) return
    await new Promise((r) => setTimeout(r, 25))
  }
}

beforeEach(async () => {
  process.env.AI_BUDGET_SHADOW = '1'
  process.env.AI_USAGE_LEDGER = '1'
  delete process.env.AI_BUDGET_POLICY
  ai.generateObject.mockReset()
  chain.value = [
    { provider: 'openai', modelId: 'gpt-5.6-sol', model: {} },
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: {} },
  ]
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  for (const k of ['AI_BUDGET_SHADOW', 'AI_USAGE_LEDGER', 'AI_BUDGET_POLICY']) delete process.env[k]
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
  await cleanup()
})

describe('shadow never blocks', () => {
  it('a would-deny still makes the identical provider call and returns its answer', async () => {
    process.env.AI_BUDGET_POLICY = JSON.stringify({ version: 'deny-all', perRequestMaxUsd: 0 })
    ai.generateObject.mockResolvedValueOnce(ok())
    const res = await call()
    expect(res).toMatchObject({ ok: true, data: { x: 'a' } })
    expect(ai.generateObject).toHaveBeenCalledTimes(1)
    expect(ai.generateObject.mock.calls[0][0]).toMatchObject({ system: 'שלום', maxOutputTokens: 500 })
    await settled()
    const [r] = await reservations()
    expect(r).toMatchObject({
      mode: 'shadow',
      decision: 'would_deny',
      denyReasons: ['request_max'],
      policyVersion: 'deny-all',
      state: 'reconciled',
      estimateBasis: 'bounded',
    })
    // Bound: bytes(system+user) at max(input, cacheWrite) + 500 output at $20 — ≥ the actual
    expect(Number(r.estimateUsd)).toBeGreaterThanOrEqual(Number(r.actualUsd))
    const [ledger] = await db('ai_usage_events').where({ agencyId: AGENCY })
    expect(ledger.callId).toBe(r.callId)
  })

  it('a broken shadow store changes nothing for the request', async () => {
    ai.generateObject.mockResolvedValueOnce(ok())
    await db.raw('ALTER TABLE ai_budget_reservations RENAME TO ai_budget_reservations_hidden')
    try {
      expect((await call()).ok).toBe(true)
      expect(ai.generateObject).toHaveBeenCalledTimes(1)
    } finally {
      await db.raw('ALTER TABLE ai_budget_reservations_hidden RENAME TO ai_budget_reservations')
    }
  })

  it('flag absent: no reservation at all', async () => {
    delete process.env.AI_BUDGET_SHADOW
    ai.generateObject.mockResolvedValueOnce(ok())
    expect((await call()).ok).toBe(true)
    expect(await reservations()).toHaveLength(0)
  })
})

describe('retries, fallbacks and unknown cost', () => {
  it('each attempt is reserved; the timed-out one is charged its estimate, the fallback its actual', async () => {
    ai.generateObject.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok('claude-sonnet-4-6'))
    expect((await call()).ok).toBe(true)
    await settled()
    const [first, second] = await reservations()
    expect(first).toMatchObject({ provider: 'openai', state: 'failed', actualUsd: null })
    expect(Number(first.chargedUsd)).toBe(Number(first.estimateUsd))
    expect(second).toMatchObject({ provider: 'anthropic', state: 'reconciled' })
  })

  it('an unpriced model: unbounded estimate (would-deny by policy), unknown cost charged at the reserve', async () => {
    chain.value = [{ provider: 'openai', modelId: 'gpt-5.6', model: {} }]
    ai.generateObject.mockResolvedValueOnce({ object: { x: 'a' }, usage: undefined, response: {}, finishReason: 'stop' })
    expect((await call()).ok).toBe(true)
    await settled()
    const [r] = await reservations()
    expect(r).toMatchObject({
      estimateBasis: 'unbounded',
      costMetadataIncomplete: true,
      decision: 'would_deny',
      denyReasons: ['max_cost_unbounded'],
      state: 'unknown_cost',
    })
    expect(Number(r.chargedUsd)).toBe(0.1)
  })
})

describe('identity', () => {
  it('the operation, conversation and a HASHED contact come from the server-side context', async () => {
    await agency('__budget_shadow__', AGENCY)
    const conv = await conversation(AGENCY, { lead: false })
    ai.generateObject.mockResolvedValueOnce(ok())
    await withAiOperation({ kind: 'auto_response_job', id: '42', agencyId: AGENCY, conversationId: conv.id }, call)
    await settled()
    const [r] = await reservations()
    expect(r).toMatchObject({ operationKind: 'auto_response_job', operationId: '42', conversationId: String(conv.id) })
    expect(r.contactKey).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(r)).not.toContain(conv.customerWaId)
  })
})
