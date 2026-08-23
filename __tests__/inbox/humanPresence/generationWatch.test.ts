/**
 * WhatsApp Agent — cancelling an in-flight generation on human presence.
 *
 * This is the "cancel where possible" half. It is an optimisation, so the tests
 * assert BOTH that it fires when it should and that it never fails loudly: a
 * broken watcher must degrade to "generate, then discard at the boundary", never
 * to a cancelled turn the human never asked for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readHumanPresence = vi.hoisted(() => vi.fn())
vi.mock('@/db/conversationHumanPresence', () => ({ readHumanPresence }))
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))

import { watchHumanPresence } from '@/lib/inbox/autoresponse/humanPresenceWatch'
import { HUMAN_TYPING_TTL_MS } from '@/lib/inbox/autoresponse/humanPresence'

const T0 = Date.parse('2026-08-23T09:00:00.000Z')
const at = (ms: number): string => new Date(T0 + ms).toISOString()
const TURN = at(0)

const CLEAN = { aiState: 'ai_qualifying', humanTypingUntil: null, humanTypingAt: null, now: at(1_000) }
const TYPING = {
  aiState: 'ai_qualifying',
  humanTypingAt: at(2_000),
  humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
  now: at(3_000),
}

/** Resolves when the watch aborts, or after `ms` if it never does (≥3 polls). */
function aborted(signal: AbortSignal, ms = 1_000): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      { once: true },
    )
  })
}

beforeEach(() => {
  readHumanPresence.mockReset().mockResolvedValue(CLEAN)
})

describe('watchHumanPresence', () => {
  it('aborts the generation once the rep starts typing', async () => {
    readHumanPresence.mockResolvedValueOnce(CLEAN).mockResolvedValue(TYPING)
    const watch = watchHumanPresence({ conversationId: 1, turnStartedAt: TURN, intervalMs: 250 })
    try {
      expect(await aborted(watch.signal)).toBe(true)
      expect(watch.cancelled()).toBe(true)
    } finally {
      watch.stop()
    }
  })

  it('aborts once the rep has sent — takeover cancels too', async () => {
    readHumanPresence.mockResolvedValue({ ...CLEAN, aiState: 'human_active' })
    const watch = watchHumanPresence({ conversationId: 1, turnStartedAt: TURN, intervalMs: 250 })
    try {
      expect(await aborted(watch.signal)).toBe(true)
    } finally {
      watch.stop()
    }
  })

  it('leaves a clean conversation alone', async () => {
    const watch = watchHumanPresence({ conversationId: 1, turnStartedAt: TURN, intervalMs: 250 })
    try {
      expect(await aborted(watch.signal)).toBe(false)
      expect(watch.cancelled()).toBe(false)
      expect(readHumanPresence).toHaveBeenCalled()
    } finally {
      watch.stop()
    }
  })

  it('a failing presence read never aborts on its own', async () => {
    // The outbound guard fails closed for us and is the authority; killing a
    // generation because the database hiccupped would waste real turns.
    readHumanPresence.mockRejectedValue(new Error('pool timeout'))
    const watch = watchHumanPresence({ conversationId: 1, turnStartedAt: TURN, intervalMs: 250 })
    try {
      expect(await aborted(watch.signal)).toBe(false)
      expect(watch.cancelled()).toBe(false)
    } finally {
      watch.stop()
    }
  })

  it('stop() ends the polling', async () => {
    const watch = watchHumanPresence({ conversationId: 1, turnStartedAt: TURN, intervalMs: 250 })
    watch.stop()
    const before = readHumanPresence.mock.calls.length
    await new Promise((r) => setTimeout(r, 600))
    expect(readHumanPresence.mock.calls.length).toBe(before)
  })

  it('typing from an EARLIER turn does not cancel this one', async () => {
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(-90_000),
      humanTypingUntil: at(-90_000 + HUMAN_TYPING_TTL_MS),
      now: at(1_000),
    })
    const watch = watchHumanPresence({ conversationId: 1, turnStartedAt: TURN, intervalMs: 250 })
    try {
      expect(await aborted(watch.signal)).toBe(false)
    } finally {
      watch.stop()
    }
  })

  it('self-terminates so an unstopped watch cannot outlive its turn', async () => {
    const watch = watchHumanPresence({
      conversationId: 1,
      turnStartedAt: TURN,
      intervalMs: 250,
      maxDurationMs: 1_000,
    })
    await new Promise((r) => setTimeout(r, 1_200))
    const after = readHumanPresence.mock.calls.length
    await new Promise((r) => setTimeout(r, 600))
    expect(readHumanPresence.mock.calls.length).toBe(after)
    watch.stop()
  })
})
