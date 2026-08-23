/**
 * WhatsApp Agent — the final outbound authorization boundary.
 *
 * Covers what the pure model cannot: that the guard READS FRESH every time, that
 * an unreadable presence row fails CLOSED, and that two workers racing the same
 * moment reach the same refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readHumanPresence = vi.hoisted(() => vi.fn())
vi.mock('@/db/conversationHumanPresence', () => ({ readHumanPresence }))
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))

import { assertAgentSendAllowed } from '@/lib/inbox/autoresponse/agentSendGuard'
import { HUMAN_TYPING_TTL_MS } from '@/lib/inbox/autoresponse/humanPresence'

const T0 = Date.parse('2026-08-23T09:00:00.000Z')
const at = (ms: number): string => new Date(T0 + ms).toISOString()
const TURN = at(0)

const clean = { aiState: 'ai_qualifying', humanTypingUntil: null, humanTypingAt: null, now: at(5_000) }
const typing = {
  aiState: 'ai_qualifying',
  humanTypingAt: at(2_000),
  humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
  now: at(5_000),
}

beforeEach(() => {
  readHumanPresence.mockReset()
})

describe('assertAgentSendAllowed', () => {
  it('authorizes an untouched conversation', async () => {
    readHumanPresence.mockResolvedValue(clean)
    await expect(assertAgentSendAllowed({ conversationId: 1, turnStartedAt: TURN })).resolves.toEqual({
      authorized: true,
    })
  })

  it('refuses once a keystroke has landed in this turn', async () => {
    readHumanPresence.mockResolvedValue(typing)
    await expect(assertAgentSendAllowed({ conversationId: 1, turnStartedAt: TURN })).resolves.toEqual({
      authorized: false,
      reason: 'human_typing_this_turn',
    })
  })

  it('refuses permanently once the rep has sent', async () => {
    readHumanPresence.mockResolvedValue({ ...clean, aiState: 'human_active' })
    await expect(assertAgentSendAllowed({ conversationId: 1, turnStartedAt: TURN })).resolves.toEqual({
      authorized: false,
      reason: 'human_active',
    })
  })

  it('FAILS CLOSED when presence cannot be read', async () => {
    // We cannot prove the human is absent, so we do not speak for them.
    readHumanPresence.mockRejectedValue(new Error('connection terminated'))
    await expect(assertAgentSendAllowed({ conversationId: 1, turnStartedAt: TURN })).resolves.toEqual({
      authorized: false,
      reason: 'presence_unavailable',
    })
  })

  it('never reuses an earlier verdict — every call re-reads presence', async () => {
    readHumanPresence.mockResolvedValueOnce(clean).mockResolvedValueOnce(typing)
    const first = await assertAgentSendAllowed({ conversationId: 7, turnStartedAt: TURN })
    const second = await assertAgentSendAllowed({ conversationId: 7, turnStartedAt: TURN })
    expect(first.authorized).toBe(true)
    expect(second.authorized).toBe(false)
    expect(readHumanPresence).toHaveBeenCalledTimes(2)
  })

  it('uses the DATABASE clock, not the process clock, for the TTL', async () => {
    // Process time is irrelevant here: `now` comes back with the row, from the
    // same clock that stamped it, so worker/database skew cannot decide a send.
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(-60_000),
      humanTypingUntil: at(-60_000 + HUMAN_TYPING_TTL_MS),
      now: at(-30_000),
    })
    await expect(
      assertAgentSendAllowed({ conversationId: 1, turnStartedAt: at(-120_000) }),
    ).resolves.toEqual({ authorized: false, reason: 'human_typing_this_turn' })
  })
})

describe('concurrent workers', () => {
  it('two workers evaluating the same conversation both refuse', async () => {
    readHumanPresence.mockResolvedValue(typing)
    const [a, b] = await Promise.all([
      assertAgentSendAllowed({ conversationId: 5, turnStartedAt: TURN }),
      assertAgentSendAllowed({ conversationId: 5, turnStartedAt: TURN }),
    ])
    expect(a).toEqual({ authorized: false, reason: 'human_typing_this_turn' })
    expect(b).toEqual({ authorized: false, reason: 'human_typing_this_turn' })
  })

  it('a worker that read BEFORE the keystroke still refuses when it asks again', async () => {
    // Worker A checked early and was cleared; the rep then started typing. The
    // guard is not a ticket you hold — it is asked again at the boundary.
    readHumanPresence.mockResolvedValueOnce(clean)
    expect((await assertAgentSendAllowed({ conversationId: 5, turnStartedAt: TURN })).authorized).toBe(true)
    readHumanPresence.mockResolvedValue(typing)
    expect((await assertAgentSendAllowed({ conversationId: 5, turnStartedAt: TURN })).authorized).toBe(false)
  })
})
