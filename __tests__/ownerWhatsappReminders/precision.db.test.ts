import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { findReminderCandidates } from '@/db/ownerWhatsappReminders/candidates'
import { scheduleReminder } from '@/db/ownerWhatsappReminders/schedule'
import { ONE_OFF_AGENCY_ID, sendOneOffReminder } from '@/lib/ownerWhatsappReminders/oneOffSend'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { MIN, ago, agency, cleanup, clearEnv, conversation, deliveries, escalateWithMicros, exactEscalatedAt, mockGraph, recipient, resetBetweenTests, setLiveEnv, user } from './reminderFixtures'
import { setOneOffEnv } from './oneOffFixtures'

/**
 * Production escalations carry microseconds (PostgreSQL `now()`); a JS Date
 * keeps milliseconds. Every path must match and store the exact value, or the
 * cron never schedules, the sender cancels every delivery, and the one-off is
 * cancelled at its pre-send re-check (production, conversation 20527).
 */
const A = ONE_OFF_AGENCY_ID

/** The reminder row's escalation equals the conversation's, in SQL, to the microsecond. */
async function reminderMatchesEscalationExactly(conversationId: number): Promise<boolean> {
  const { rows } = await db.raw(
    `SELECT r."escalatedAt" = ai."escalatedAt" AS equal
       FROM owner_whatsapp_reminders r JOIN conversation_ai_state ai ON ai."conversationId" = r."conversationId"
      WHERE r."conversationId" = ? AND r.status <> 'cancelled'`,
    [conversationId],
  )
  return rows.length === 1 && rows[0].equal === true
}

async function microHandoff(digits: string, escalatedAgo: number) {
  const admin = await user(A)
  const recipientId = await recipient(A, admin, digits)
  const c = await conversation(A, { lead: false })
  await escalateWithMicros(c, ago(escalatedAgo))
  return { c, admin, recipientId }
}

/** A delivery row for the recipient in a given state, on another hand-off. */
async function priorDelivery(recipientId: number, status: string) {
  const other = await conversation(A, { lead: false })
  const [r] = await db('owner_whatsapp_reminders').insert({ agencyId: A, conversationId: other.id, escalatedAt: ago(200 * MIN), status: status === 'cancelled' ? 'cancelled' : 'done' }).returning('id')
  await db('owner_whatsapp_reminder_deliveries').insert({ reminderId: r.id, recipientId, agencyId: A, conversationId: other.id, status, attempts: status === 'scheduled' ? 0 : 1, nextAttemptAt: new Date() })
}

beforeAll(async () => {
  await agency('__owr_precision_103__', A)
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('auto_response_settings').where({ agencyId: A }).del()
  clearEnv()
  delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
  await cleanup()
})

describe('the fixture really has sub-millisecond precision', () => {
  it('the stored escalation is not representable as a JS Date', async () => {
    const h = await microHandoff('972500001001', 121 * MIN)
    const exact = await exactEscalatedAt(h.c.id)
    expect(exact).toMatch(/\.\d{6}/)
    const { rows } = await db.raw('SELECT "escalatedAt" = ?::timestamptz AS equal FROM conversation_ai_state WHERE "conversationId" = ?', [new Date(exact).toISOString(), h.c.id])
    expect(rows[0].equal).toBe(false)
  })
})

describe('cron', () => {
  it('finds the candidate with its exact escalation', async () => {
    const h = await microHandoff('972500001002', 121 * MIN)
    const [cand] = await findReminderCandidates(new Date(), [A], 10)
    expect(cand.escalatedAtExact).toBe(await exactEscalatedAt(h.c.id))
  })

  it('schedules and sends a microsecond escalation, storing it exactly', async () => {
    const h = await microHandoff('972500001003', 121 * MIN)
    setLiveEnv([A])
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick.scheduled).toBe(1)
    expect(tick.sends).toEqual({ sent: 1 })
    expect(g.calls).toHaveLength(1)
    expect(await deliveries()).toMatchObject([{ status: 'sent', wamid: 'wamid.SENT_1' }])
    expect(await reminderMatchesEscalationExactly(h.c.id)).toBe(true)
  })

  it('the already-reminded check matches: a second tick neither schedules nor sends again', async () => {
    await microHandoff('972500001004', 121 * MIN)
    setLiveEnv([A])
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    const second = await tickOwnerWhatsappReminders()
    expect(second.candidates).toBe(0)
    expect(g.calls).toHaveLength(1)
    expect(await db('owner_whatsapp_reminders')).toHaveLength(1)
  })

  it('a delivery scheduled earlier passes the send-time re-check under lock', async () => {
    const h = await microHandoff('972500001005', 121 * MIN)
    const now = new Date()
    const [cand] = await findReminderCandidates(now, [A], 10)
    expect(await scheduleReminder({ candidate: cand, recipientIds: [h.recipientId], agencyIds: [A], notBefore: new Date(now.getTime() + 60 * MIN), now })).toBe('scheduled')
    await db('owner_whatsapp_reminder_deliveries').update({ nextAttemptAt: ago(MIN) })
    setLiveEnv([A])
    const g = mockGraph()
    const tick = await tickOwnerWhatsappReminders()
    expect(tick.sends).toEqual({ sent: 1 })
    expect(g.calls).toHaveLength(1)
    expect((await deliveries())[0]).toMatchObject({ status: 'sent' })
  })
})

describe('one-off', () => {
  it('a microsecond escalation passes the claim AND the fresh pre-send re-check', async () => {
    const h = await microHandoff('972500001011', 5 * MIN)
    setOneOffEnv(h.recipientId)
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toMatchObject({ outcome: 'sent' })
    expect(g.calls).toHaveLength(1)
    expect(await reminderMatchesEscalationExactly(h.c.id)).toBe(true)
  })

  it('production state (20527): a cancelled attempt and its millisecond reminder row do not block the retry', async () => {
    const h = await microHandoff('972500001012', 40 * MIN)
    setOneOffEnv(h.recipientId)
    // What the buggy build left: the escalation truncated to milliseconds, all cancelled before any Meta call.
    const truncated = new Date(await exactEscalatedAt(h.c.id))
    const [r] = await db('owner_whatsapp_reminders').insert({ agencyId: A, conversationId: h.c.id, escalatedAt: truncated, status: 'cancelled', cancelReason: 'all_deliveries_cancelled' }).returning('id')
    await db('owner_whatsapp_reminder_deliveries').insert({ reminderId: r.id, recipientId: h.recipientId, agencyId: A, conversationId: h.c.id, status: 'cancelled', cancelReason: 'no_longer_eligible', attempts: 1, nextAttemptAt: new Date() })
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toMatchObject({ outcome: 'sent' })
    expect(g.calls).toHaveLength(1)
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toHaveLength(1)
  })
})

describe('one-off single use by delivery state', () => {
  it('a cancelled delivery does not use the allowance', async () => {
    const h = await microHandoff('972500001021', 5 * MIN)
    setOneOffEnv(h.recipientId)
    await priorDelivery(h.recipientId, 'cancelled')
    const g = mockGraph()
    expect((await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).outcome).toBe('sent')
    expect(g.calls).toHaveLength(1)
  })

  it.each(['sending', 'sent', 'unknown', 'failed', 'scheduled'])('a %s delivery uses it: refused, no Meta call', async (status) => {
    const h = await microHandoff('972500001022', 5 * MIN)
    setOneOffEnv(h.recipientId)
    await priorDelivery(h.recipientId, status)
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toEqual([])
  })

  it('an unknown outcome stays final across a retry', async () => {
    const h = await microHandoff('972500001023', 5 * MIN)
    setOneOffEnv(h.recipientId)
    const g = mockGraph(() => new Response(JSON.stringify({ error: { code: 1 } }), { status: 503 }))
    expect((await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).outcome).toBe('unknown')
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toHaveLength(1)
  })
})
