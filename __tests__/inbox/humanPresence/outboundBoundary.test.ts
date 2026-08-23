/**
 * WhatsApp Agent — the boundary as it actually runs.
 *
 * The pure model proves the decision; this proves the WIRING: that a refused
 * send makes NO Graph call, persists NO message, and leaves no trace in the
 * conversation. Everything the agent says autonomously goes through
 * `sendIreOutbound` — qualify turns, closers, handoff, post-handoff, and the
 * no-response warning/close.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readHumanPresence = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const applyIreWhatsappSendFailure = vi.hoisted(() => vi.fn())
const connectionRow = vi.hoisted(() => ({
  value: { phone_number_id: '972007939322425', access_token: 't', user_id: 332 } as unknown,
}))
// main's assertIreSendAllowed re-reads the conversation immediately before the
// Graph call: it must exist, not be personal, and belong to this agency.
const conversationRow = vi.hoisted(() => ({ value: { id: 382, isPersonal: false } as unknown }))

vi.mock('@/db/conversationHumanPresence', () => ({ readHumanPresence }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
vi.mock('@/lib/inbox/onWhatsappSendFailure', () => ({ applyIreWhatsappSendFailure }))
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))
vi.mock('@/config/db', () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {}
    const self = () => c
    c.where = self
    c.update = async () => 1
    c.first = async () => (table === 'inbox_conversations' ? conversationRow.value : connectionRow.value)
    return c
  }
  return {
    db: Object.assign((table: string) => chain(table), {
      raw: (sql: string) => sql,
      fn: { now: () => new Date() },
      transaction: async (fn: (trx: unknown) => unknown) => fn({}),
    }),
  }
})

import { sendIreOutbound } from '@/lib/inbox/autoresponse/ireSend'
import { HUMAN_TYPING_TTL_MS } from '@/lib/inbox/autoresponse/humanPresence'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

const T0 = Date.parse('2026-08-23T09:00:00.000Z')
const at = (ms: number): string => new Date(T0 + ms).toISOString()

/** The customer's message created this job. Its createdAt is the turn epoch. */
const JOB: AutoResponseJob = {
  id: 91,
  agencyId: 103,
  conversationId: 382,
  leadId: 1417,
  channel: 'whatsapp',
  reason: 'qualify_turn',
  triggerSequence: 4,
  attempts: 1,
  maxAttempts: 3,
  createdAt: at(0),
}

const CTX = {
  conv: { id: 382, businessPhoneNumberId: '972007939322425', customerWaId: '972524186300', customerName: 'george' },
  lead: { userId: 332, handlerId: null },
}

const clean = { aiState: 'ai_qualifying', humanTypingUntil: null, humanTypingAt: null, now: at(5_000) }

beforeEach(() => {
  readHumanPresence.mockReset().mockResolvedValue(clean)
  persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001, sequence: 9 })
  applyIreWhatsappSendFailure.mockReset().mockResolvedValue(undefined)
  connectionRow.value = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
  conversationRow.value = { id: 382, isPersonal: false }
})

describe('the agent sends normally when no human is present', () => {
  it('reaches Meta and persists the message', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.1' }))
    const r = await sendIreOutbound(JOB, CTX, send, 'מה הכי מפריע לך בזה?')
    expect(r).toEqual({ ok: true, messageId: 4001, sequence: 9 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(persistOutboundWhatsapp).toHaveBeenCalledTimes(1)
  })
})

describe('THE RACE: customer → generate → human types → generate finishes → send', () => {
  it('refuses the send, calls no Graph API, and persists nothing', async () => {
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(2_000),
      humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
      now: at(9_000),
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.must-not-happen' }))
    const r = await sendIreOutbound(JOB, CTX, send, 'מה הכי מפריע לך בזה?')

    expect(r).toEqual({ ok: false, reason: 'human_typing_this_turn' })
    expect(send).not.toHaveBeenCalled()
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
    expect(applyIreWhatsappSendFailure).not.toHaveBeenCalled()
  })

  it('the guard sits between the IRE gate and the Graph call, exactly as main orders it', async () => {
    // main's order is: connection lookup → assertIreSendAllowed → presence → send.
    // A missing connection therefore still short-circuits first; that is main's
    // behaviour and Human Presence must not reorder it.
    connectionRow.value = null
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(2_000),
      humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
      now: at(3_000),
    })
    const send = vi.fn()
    const r = await sendIreOutbound(JOB, CTX, send, 'text')
    expect(r).toEqual({ ok: false, reason: 'no_connection' })
    // What matters: nothing reached Meta.
    expect(send).not.toHaveBeenCalled()
  })

  it("main's IRE gate refuses a personal conversation before presence is consulted", async () => {
    // The older invariant, still enforced. Not displaced by Human Presence.
    conversationRow.value = { id: 382, isPersonal: true }
    const send = vi.fn()
    const r = await sendIreOutbound(JOB, CTX, send, 'text')
    expect(r).toEqual({ ok: false, reason: 'personal' })
    expect(send).not.toHaveBeenCalled()
  })

  it("main's IRE gate refuses a deleted conversation", async () => {
    conversationRow.value = undefined
    const send = vi.fn()
    const r = await sendIreOutbound(JOB, CTX, send, 'text')
    expect(r).toEqual({ ok: false, reason: 'conversation_gone' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('a generated reply is DISCARDED, never queued for later', () => {
  it('delayed completion long after the TTL lapsed still cannot send', async () => {
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(2_000),
      humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
      now: at(600_000),
    })
    const send = vi.fn()
    const r = await sendIreOutbound(JOB, CTX, send, 'תשובה שנוצרה מזמן')
    expect(r).toEqual({ ok: false, reason: 'human_typing_this_turn' })
    expect(send).not.toHaveBeenCalled()
  })

  it('a queued reply re-attempted three times is refused every time', async () => {
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(2_000),
      humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
      now: at(120_000),
    })
    const send = vi.fn()
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await sendIreOutbound({ ...JOB, attempts: attempt }, CTX, send, 'reply')
      expect(r).toEqual({ ok: false, reason: 'human_typing_this_turn' })
    }
    expect(send).not.toHaveBeenCalled()
  })
})

describe('retries after a human takeover', () => {
  it('every retry of the job is refused with human_active', async () => {
    readHumanPresence.mockResolvedValue({ ...clean, aiState: 'human_active', now: at(3_600_000) })
    const send = vi.fn()
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await sendIreOutbound({ ...JOB, attempts: attempt }, CTX, send, 'reply')
      expect(r).toEqual({ ok: false, reason: 'human_active' })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('a brand-new job created after takeover is refused too', async () => {
    readHumanPresence.mockResolvedValue({ ...clean, aiState: 'human_active', now: at(7_200_000) })
    const send = vi.fn()
    const r = await sendIreOutbound({ ...JOB, id: 92, createdAt: at(7_000_000) }, CTX, send, 'reply')
    expect(r).toEqual({ ok: false, reason: 'human_active' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('two workers racing the same conversation', () => {
  it('neither reaches Meta once a keystroke has landed', async () => {
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(2_000),
      humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
      now: at(4_000),
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'nope' }))
    const results = await Promise.all([
      sendIreOutbound(JOB, CTX, send, 'a'),
      sendIreOutbound({ ...JOB, id: 92 }, CTX, send, 'b'),
    ])
    expect(results.every((r) => r.ok === false)).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
  })

  it('a worker whose presence read fails is refused while the other proceeds', async () => {
    readHumanPresence.mockRejectedValueOnce(new Error('pool timeout')).mockResolvedValue(clean)
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.2' }))
    const a = await sendIreOutbound(JOB, CTX, send, 'a')
    const b = await sendIreOutbound({ ...JOB, id: 92 }, CTX, send, 'b')
    expect(a).toEqual({ ok: false, reason: 'presence_unavailable' })
    expect(b.ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('the no-response warning / close path is guarded too', () => {
  it('the scheduled close message cannot land on a rep who is typing', async () => {
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(500_000),
      humanTypingUntil: at(500_000 + HUMAN_TYPING_TTL_MS),
      now: at(505_000),
    })
    const send = vi.fn()
    const r = await sendIreOutbound(
      { ...JOB, reason: 'no_response_close', createdAt: at(400_000) },
      CTX,
      send,
      'סוגרים את השיחה',
      { source: 'auto_response', reason: 'no_response_close', phase: 2, kind: 'no_response_close' },
    )
    expect(r).toEqual({ ok: false, reason: 'human_typing_this_turn' })
    expect(send).not.toHaveBeenCalled()
  })
})
