/**
 * A transcript has exactly the authority of the same words typed — no more.
 *
 * 1. The stream route reads ONLY `question` and `history`. A client that adds
 *    `source: 'voice'`, an intent, or an approval flag changes nothing that
 *    reaches askAgent.
 * 2. Intent is derived from the words alone, so a transcribed sentence gets the
 *    same verdict as the typed one (F1 applies unchanged): a question stays a
 *    proposal needing approval, and only a real instruction is a command.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireProductAccess = vi.hoisted(() => vi.fn())
const isAgentEnabled = vi.hoisted(() => vi.fn())
const askAgent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess,
}))
vi.mock('@/lib/ai/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled,
}))
vi.mock('@/actions/ai/askAgent', () => ({ askAgent }))

import { POST as streamPOST } from '@/app/api/ai/agent/stream/route'
import { deriveActionIntent } from '@/lib/agent/actions/intent'

beforeEach(() => {
  requireProductAccess.mockReset().mockResolvedValue({ id: 1, agencyId: 2 })
  isAgentEnabled.mockReset().mockReturnValue(true)
  askAgent.mockReset().mockResolvedValue({ ok: false, reason: 'error', message: 'x' })
})

describe('the stream route gives a transcript no extra authority', () => {
  it('ignores any voice / intent / approval fields a client adds', async () => {
    const req = new NextRequest('http://localhost/api/ai/agent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'איזה לידים לא מטופלים בצורה טובה',
        history: [],
        source: 'voice',
        intent: 'EXPLICIT_COMMAND',
        approved: true,
      }),
    })
    const res = await streamPOST(req)
    await res.text()
    expect(askAgent).toHaveBeenCalledTimes(1)
    const [question, , options] = askAgent.mock.calls[0]!
    expect(question).toBe('איזה לידים לא מטופלים בצורה טובה')
    expect(Object.keys(options).sort()).toEqual(['history', 'onProgress'])
  })
})

describe('intent comes from the words, so voice and typing are identical', () => {
  it.each([
    'איזה לידים לא מטופלים בצורה טובה',
    'יש צורך לחזור לדני?',
    'show my open leads',
  ])('a transcribed question is a proposal (approval required): %s', (spoken) => {
    expect(deriveActionIntent({ userMessage: spoken }).intent).toBe('AGENT_PROPOSAL')
  })

  it('a transcribed instruction is exactly as explicit as typing it — no more', () => {
    const spoken = 'תיצור לי משימה לחזור לדני מחר'
    const typed = 'תיצור לי משימה לחזור לדני מחר'
    expect(deriveActionIntent({ userMessage: spoken })).toEqual(deriveActionIntent({ userMessage: typed }))
  })

  it('the intent input has no channel field at all', () => {
    // A voice marker cannot influence the classifier because it has nowhere to go.
    const verdict = deriveActionIntent({ userMessage: 'מי צריך טיפול?', ...( { source: 'voice' } as object) } as never)
    expect(verdict.intent).toBe('AGENT_PROPOSAL')
  })
})
