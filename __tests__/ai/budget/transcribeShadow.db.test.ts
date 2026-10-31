import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Voice transcription in shadow budgets: a PARTIAL estimate at the recording
 * cap (the server cannot verify an upload's real duration), reconciled from
 * the reported duration, sharing its callId and run with its ledger row.
 * Provider mocked.
 */
const doGenerate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/providers', () => ({ getOpenAIProvider: () => ({ transcription: () => ({ doGenerate }) }) }))

import { db } from '@/config/db'
import { transcribeVoice } from '@/lib/agent/voice/transcribe'

const AGENCY = 9701
const run = () =>
  transcribeVoice({ audio: new Uint8Array([1]), container: 'webm' as never, ledger: { agencyId: AGENCY, userId: 2 } })
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
  doGenerate.mockReset()
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_BUDGET_SHADOW
  delete process.env.AI_USAGE_LEDGER
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
})

describe('transcription shadow', () => {
  it('reserves the 120 s cap ($0.012) and reconciles 30 s ($0.003)', async () => {
    doGenerate.mockResolvedValueOnce({ text: 'x', durationInSeconds: 30, response: {} })
    expect(await run()).toEqual({ text: 'x' })
    await settled()
    const [r] = await db('ai_budget_reservations').where({ agencyId: AGENCY })
    expect(r).toMatchObject({
      feature: 'voice.transcribe',
      estimateBasis: 'partial',
      costMetadataIncomplete: true,
      state: 'reconciled',
      actualCostBasis: 'estimated',
      actualCostNote: 'duration_estimate',
    })
    expect([Number(r.estimateUsd), Number(r.actualUsd)]).toEqual([0.012, 0.003])
    // One id with its ledger row, one run (its invocation): reconcilable and recoverable.
    const [row] = await db('ai_usage_events').where({ agencyId: AGENCY })
    expect(r.callId).toBe(row.callId)
    expect(r).toMatchObject({ invocationId: row.invocationId, operationKind: 'voice.transcribe', operationId: row.invocationId })
  })

  it('no reported duration: unknown cost, charged the cap estimate — never zero', async () => {
    doGenerate.mockResolvedValueOnce({ text: 'x', response: {} })
    await run()
    await settled()
    const [r] = await db('ai_budget_reservations').where({ agencyId: AGENCY })
    expect(r).toMatchObject({ state: 'unknown_cost', actualUsd: null, actualCostBasis: 'unknown' })
    expect(Number(r.chargedUsd)).toBe(0.012)
  })
})
