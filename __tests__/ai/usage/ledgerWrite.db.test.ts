import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The bounded ledger write against a real PostgreSQL: the real insert
 * (with its query timeout) persists within the wait, and a repeated call id is
 * written once — retries and re-records can never duplicate a provider request.
 */
import { db } from '@/config/db'
import { LEDGER_WAIT_MS, recordProviderCalls } from '@/lib/ai/usage/record'

const AGENCY = 9131
const call = (callId: string, inputTokens = 100) => ({
  callId,
  invocationId: `inv-${callId}`,
  feature: 'inbox.autoResponse',
  provider: 'openai',
  requestedModel: 'gpt-4.1-mini',
  responseModel: 'gpt-4.1-mini',
  status: 'success' as const,
  serviceTier: 'default',
  agencyId: AGENCY,
  usage: { inputTokens, uncachedInputTokens: inputTokens, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
})
const rows = () => db('ai_usage_events').where({ agencyId: AGENCY }).orderBy('id')

beforeEach(async () => {
  process.env.AI_USAGE_LEDGER = '1'
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_USAGE_LEDGER
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})

describe('ledger persistence', () => {
  it('persists within the bounded wait', async () => {
    const t0 = Date.now()
    await recordProviderCalls([call('lw-ok-1'), call('lw-ok-2')])
    expect(Date.now() - t0).toBeLessThan(LEDGER_WAIT_MS + 500)
    expect((await rows()).map((r) => [r.callId, r.costBasis])).toEqual([
      ['lw-ok-1', 'reported_usage'],
      ['lw-ok-2', 'reported_usage'],
    ])
  })

  it('a duplicate call id is written once, and the first row is kept', async () => {
    await recordProviderCalls([call('lw-dup', 100)])
    await recordProviderCalls([call('lw-dup', 999)])
    await Promise.all([recordProviderCalls([call('lw-dup', 1)]), recordProviderCalls([call('lw-dup', 2)])])
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ callId: 'lw-dup', inputTokens: 100 })
  })
})
