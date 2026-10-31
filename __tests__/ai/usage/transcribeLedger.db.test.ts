import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Voice transcription in the usage ledger: priced per audio minute from the
 * reported duration (an estimate), unknown without one, and a failed request
 * recorded and re-thrown unchanged. The provider is mocked.
 */
const doGenerate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/providers', () => ({ getOpenAIProvider: () => ({ transcription: () => ({ doGenerate }) }) }))

import { db } from '@/config/db'
import { transcribeVoice } from '@/lib/agent/voice/transcribe'

const AGENCY = 9301
const run = () =>
  transcribeVoice({ audio: new Uint8Array([1, 2, 3]), container: 'webm' as never, ledger: { agencyId: AGENCY, userId: 7 } })
const rows = () => db('ai_usage_events').where({ agencyId: AGENCY })

beforeEach(async () => {
  process.env.AI_USAGE_LEDGER = '1'
  doGenerate.mockReset()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_USAGE_LEDGER
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})

describe('transcription ledger', () => {
  it('30 s of audio: $0.003, marked estimated, with the duration', async () => {
    doGenerate.mockResolvedValueOnce({ text: ' שלום ', durationInSeconds: 30, response: { modelId: 'gpt-4o-transcribe' } })
    expect(await run()).toEqual({ text: 'שלום' })
    const [r] = await rows()
    expect(r).toMatchObject({
      feature: 'voice.transcribe',
      provider: 'openai',
      status: 'success',
      costBasis: 'estimated',
      costNote: 'duration_estimate',
      userId: 7,
      audioSeconds: '30.00',
    })
    expect(Number(r.costUsd)).toBeCloseTo(0.003, 9)
  })

  it('no reported duration: cost unknown, never the flat 120 s charge or zero', async () => {
    doGenerate.mockResolvedValueOnce({ text: 'x', durationInSeconds: undefined, response: {} })
    await run()
    const [r] = await rows()
    expect(r).toMatchObject({ costUsd: null, costBasis: 'unknown' })
  })

  it('a provider failure is recorded and re-thrown unchanged', async () => {
    const err = Object.assign(new Error('boom'), { name: 'AI_APICallError' })
    doGenerate.mockRejectedValueOnce(err)
    await expect(run()).rejects.toBe(err)
    const [r] = await rows()
    expect(r).toMatchObject({ status: 'error', errorCode: 'AI_APICallError', costBasis: 'unknown' })
  })
})
