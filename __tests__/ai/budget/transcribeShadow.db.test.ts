import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** Voice transcription in shadow budgets: bounded by the recording cap, reconciled from the reported duration. Provider mocked. */
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
  doGenerate.mockReset()
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_BUDGET_SHADOW
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
})

describe('transcription shadow', () => {
  it('reserves the 120 s cap ($0.012) and reconciles 30 s ($0.003)', async () => {
    doGenerate.mockResolvedValueOnce({ text: 'x', durationInSeconds: 30, response: {} })
    expect(await run()).toEqual({ text: 'x' })
    await settled()
    const [r] = await db('ai_budget_reservations').where({ agencyId: AGENCY })
    expect(r).toMatchObject({ feature: 'voice.transcribe', estimateBasis: 'bounded', state: 'reconciled' })
    expect([Number(r.estimateUsd), Number(r.actualUsd)]).toEqual([0.012, 0.003])
  })
})
