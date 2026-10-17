import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { claimOneOffDelivery, recheckBeforeSend } from '@/db/ownerWhatsappReminders/oneOff'
import { ONE_OFF_AGENCY_ID, sendOneOffReminder } from '@/lib/ownerWhatsappReminders/oneOffSend'
import { REMINDER_DELAY_MS } from '@/lib/ownerWhatsappReminders/constants'
import { sendOwnerReminder } from '@/lib/whatsapp/platform/sendReminder'
import { MIN, PLATFORM, ago, agency, cleanup, clearEnv, conversation, deliveries, escalate, message, mockGraph, recipient, resetBetweenTests, sentTo, user } from './reminderFixtures'
import { dueHandoff, json, liveCronLater, setOneOffEnv, stop } from './oneOffFixtures'

/**
 * The one-off test send: agency 103 only, the one configured recipient, one
 * real eligible hand-off, single use, no transaction across the Meta request,
 * never retried, and nothing the cron can later send.
 *
 * NOTE: over the 250-line soft limit on purpose. It is one flat list of
 * independent scenarios sharing three helpers; splitting it would duplicate the
 * fixtures and the env setup across files for no readability gain.
 */
const A = ONE_OFF_AGENCY_ID
let B: number
let seq = 0

beforeAll(async () => {
  await agency('__owr_oneoff_103__', A)
  B = await agency('__owr_oneoff_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('auto_response_settings').whereIn('agencyId', [A, B]).del()
  clearEnv()
  delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
  await cleanup()
})

describe('one send, to the configured recipient only', () => {
  it('sends the approved template once and records it like the cron', async () => {
    const h = await dueHandoff('972500000901')
    const g = mockGraph()
    const r = await sendOneOffReminder({ conversationId: h.c.id })
    expect(r).toMatchObject({ outcome: 'sent', wamid: 'wamid.SENT_1' })
    expect(g.calls).toHaveLength(1)
    expect(sentTo(g.calls)).toEqual(['972500000901'])
    expect(g.calls[0].url).toContain(`/${PLATFORM}/messages`)
    expect(g.calls[0].body.template.name).toBe('lead_followup_alert')
    expect(g.calls[0].body.template.components[1].parameters[0].text).toBe(String(h.c.id))
    expect(await deliveries()).toMatchObject([{ recipientId: String(h.recipientId), status: 'sent', wamid: 'wamid.SENT_1', attempts: 1 }])
    expect(await db('owner_whatsapp_reminders')).toMatchObject([{ status: 'done' }])
  })

  it('does not need, and does not turn on, the global send flag', async () => {
    const h = await dueHandoff('972500000902')
    mockGraph()
    expect((await sendOneOffReminder({ conversationId: h.c.id })).outcome).toBe('sent')
    expect(process.env.OWNER_WA_REMINDERS_SEND_ENABLED).toBeUndefined()
  })
})

describe('single use and concurrency', () => {
  it('a second call after a send is refused without calling Meta', async () => {
    const h = await dueHandoff('972500000911')
    const g = mockGraph()
    await sendOneOffReminder({ conversationId: h.c.id })
    const other = await conversation(A, { lead: false })
    await escalate(other, ago(121 * MIN))
    expect(await sendOneOffReminder({ conversationId: other.id })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toHaveLength(1)
  })

  it('two concurrent calls make exactly one Meta request', async () => {
    const h = await dueHandoff('972500000912')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const g = mockGraph(async (n) => {
      await gate
      return json({ messages: [{ id: `wamid.CONCURRENT_${n}` }] }, 200)
    })
    const both = Promise.all([sendOneOffReminder({ conversationId: h.c.id }), sendOneOffReminder({ conversationId: h.c.id })])
    await vi.waitFor(() => expect(g.calls).toHaveLength(1), { timeout: 5000 })
    release()
    const results = await both
    expect(results.map((r) => r.outcome).sort()).toEqual(['refused', 'sent'])
    expect(results.find((r) => r.outcome === 'refused')).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toHaveLength(1)
    expect(await deliveries()).toHaveLength(1)
  })

  it('no transaction is open during the Meta request: the recipient row is not locked', async () => {
    const h = await dueHandoff('972500000913')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const g = mockGraph(async () => {
      await gate
      return json({ messages: [{ id: 'wamid.NOLOCK' }] }, 200)
    })
    const send = sendOneOffReminder({ conversationId: h.c.id })
    await vi.waitFor(() => expect(g.calls).toHaveLength(1), { timeout: 5000 })
    // NOWAIT fails at once if any transaction still holds the row.
    await db.transaction(async (trx) => {
      await trx.raw('SELECT id FROM owner_whatsapp_recipients WHERE id = ? FOR UPDATE NOWAIT', [h.recipientId])
    })
    release()
    expect((await send).outcome).toBe('sent')
  })
})

describe('refused before anything is written', () => {
  it('route off, agency 103 not allowlisted, or platform not configured', async () => {
    const h = await dueHandoff('972500000921')
    const g = mockGraph()
    delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'not_configured' })
    setOneOffEnv(h.recipientId)
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(B)
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'agency_not_allowlisted' })
    setOneOffEnv(h.recipientId)
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'platform_not_configured' })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })

  it('a conversation of another agency', async () => {
    const h = await dueHandoff('972500000922')
    const foreign = await conversation(B, { lead: false })
    await escalate(foreign, ago(121 * MIN))
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: foreign.id })).toEqual({ outcome: 'refused', reason: 'conversation_not_eligible' })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
    expect(h.recipientId).toBeGreaterThan(0)
  })

  it('a configured recipient of another agency', async () => {
    const h = await dueHandoff('972500000923')
    const foreignRecipient = await recipient(B, await user(B), '972500000924')
    process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = String(foreignRecipient)
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'recipient_not_active' })
    expect(g.calls).toEqual([])
  })

  it.each([
    ['pending', { status: 'pending', phoneE164: null, verifiedAt: null }],
    ['opted out', { status: 'opted_out', optedOutAt: new Date() }],
  ])('consent %s', async (_label, patch) => {
    const h = await dueHandoff('972500000925')
    await db('owner_whatsapp_recipients').where({ id: h.recipientId }).update(patch)
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'recipient_not_active' })
    expect(g.calls).toEqual([])
  })

  it('a suspended recipient user', async () => {
    const h = await dueHandoff('972500000926')
    await db('users').where({ id: h.admin }).update({ suspended: true })
    mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'recipient_not_active' })
  })

  it('a recipient the cron would not use (verified after the hand-off)', async () => {
    const h = await dueHandoff('972500000927', { verifiedAt: new Date() })
    mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'recipient_not_selected' })
    expect(await deliveries()).toEqual([])
  })

  it.each([
    ['not escalated', async (h: Awaited<ReturnType<typeof dueHandoff>>) => { await db('conversation_ai_state').where({ conversationId: h.c.id }).update({ aiState: 'human_active' }) }],
    ['answered by a human', async (h: Awaited<ReturnType<typeof dueHandoff>>) => { await message(h.c, { dir: 'outbound', at: new Date(), userId: h.admin }) }],
    ['under 120 minutes old', async (h: Awaited<ReturnType<typeof dueHandoff>>) => { await escalate(h.c, ago(30 * MIN)) }],
    ['over 24 hours old', async (h: Awaited<ReturnType<typeof dueHandoff>>) => { await escalate(h.c, ago(25 * 60 * MIN)) }],
    ['closed', async (h: Awaited<ReturnType<typeof dueHandoff>>) => { await db('inbox_conversations').where({ id: h.c.id }).update({ state: 'closed' }) }],
  ])('a conversation that is %s', async (_label, mutate) => {
    const h = await dueHandoff(`97250000093${++seq % 10}`)
    await mutate(h)
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'conversation_not_eligible' })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })

  it('a lead that is closed or lost', async () => {
    for (const leadStatus of ['closed', 'lost']) {
      await resetBetweenTests()
      const admin = await user(A)
      const recipientId = await recipient(A, admin, '972500000941')
      const c = await conversation(A, { leadStatus })
      await escalate(c, ago(121 * MIN))
      setOneOffEnv(recipientId)
      mockGraph()
      expect(await sendOneOffReminder({ conversationId: c.id })).toEqual({ outcome: 'refused', reason: 'conversation_not_eligible' })
      vi.restoreAllMocks()
    }
  })

  it("inside agency 103's quiet hours: refused, nothing written, nothing left for later", async () => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jerusalem' }).format(new Date()))
    await db('auto_response_settings').insert({ agencyId: A, channel: 'whatsapp', quietHours: { tz: 'Asia/Jerusalem', startHour: hour, endHour: (hour + 2) % 24 } })
    const h = await dueHandoff('972500000942')
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'quiet_hours' })
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })
})

describe('opt-out compatibility', () => {
  it('an opt-out committed after the claim and before the fresh read cancels the send', async () => {
    const h = await dueHandoff('972500000951')
    const now = new Date()
    const claimed = await claimOneOffDelivery({ recipientId: h.recipientId, agencyId: A, conversationId: h.c.id, agencyIds: [A], delayMs: REMINDER_DELAY_MS, now })
    if (claimed.ok === false) throw new Error(claimed.reason)
    expect(await stop('972500000951')).toBe('opted_out')
    expect(await recheckBeforeSend({ recipientId: h.recipientId, agencyId: A, conversationId: h.c.id, claim: claimed.claim, agencyIds: [A], delayMs: REMINDER_DELAY_MS, now })).toEqual({ ok: false, reason: 'recipient_not_active' })
  })

  it('a settings opt-out before the call: refused, no request', async () => {
    const h = await dueHandoff('972500000952')
    await db('owner_whatsapp_recipients').where({ id: h.recipientId }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'settings' })
    const g = mockGraph()
    expect((await sendOneOffReminder({ conversationId: h.c.id })).outcome).toBe('refused')
    expect(g.calls).toEqual([])
  })

  it('RESIDUAL RACE (documented): an opt-out during the in-flight request is not blocked and cannot stop it', async () => {
    const h = await dueHandoff('972500000953')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const g = mockGraph(async () => {
      await gate
      return json({ messages: [{ id: 'wamid.RACE' }] }, 200)
    })
    const send = sendOneOffReminder({ conversationId: h.c.id })
    await vi.waitFor(() => expect(g.calls).toHaveLength(1), { timeout: 5000 })
    // The opt-out is not blocked by the send (no lock is held) and commits.
    expect(await stop('972500000953')).toBe('opted_out')
    release()
    expect((await send).outcome).toBe('sent')
    expect(await db('owner_whatsapp_recipients').where({ id: h.recipientId }).first('status')).toEqual({ status: 'opted_out' })
  })
})

describe('outcomes are final: never retried, never sent later by the cron', () => {
  it.each([
    ['a 5xx', () => json({ error: { code: 1 } }, 503), 'server_error'],
    ['a 2xx without a message id', () => json({}, 200), 'no_message_id'],
  ])('%s is unknown', async (_label, reply, reason) => {
    const h = await dueHandoff('972500000961')
    const g = mockGraph(reply)
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toMatchObject({ outcome: 'unknown', reason })
    expect(await deliveries()).toMatchObject([{ status: 'unknown', errorCode: reason }])
    await liveCronLater()
    expect(g.calls).toHaveLength(1)
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'already_used' })
  })

  it('a timeout is unknown', async () => {
    const h = await dueHandoff('972500000962')
    const g = mockGraph(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toMatchObject({ outcome: 'unknown', reason: 'timeout' })
    await liveCronLater()
    expect(g.calls).toHaveLength(1)
  })

  it('a rate limit is failed, never rescheduled', async () => {
    const h = await dueHandoff('972500000963')
    const g = mockGraph(() => json({ error: { code: 130429 } }, 429))
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toMatchObject({ outcome: 'failed', scope: 'rate_limit', code: '130429' })
    expect(await deliveries()).toMatchObject([{ status: 'failed', errorScope: 'rate_limit' }])
    await liveCronLater()
    expect(g.calls).toHaveLength(1)
    expect((await deliveries()).map((d) => d.status)).toEqual(['failed'])
  })

  it('a recipient rejection is failed', async () => {
    const h = await dueHandoff('972500000964')
    mockGraph(() => json({ error: { code: 131026 } }, 400))
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toMatchObject({ outcome: 'failed', scope: 'recipient', code: '131026' })
  })
})

describe('process interruption', () => {
  it('after the claim, before the Meta request: left sending, reaped to unknown, never sent', async () => {
    const h = await dueHandoff('972500000971')
    const g = mockGraph()
    const crash = async () => { throw new Error('process died before the request') }
    await expect(sendOneOffReminder({ conversationId: h.c.id }, { send: crash })).rejects.toThrow()
    expect(await deliveries()).toMatchObject([{ status: 'sending' }])
    await liveCronLater()
    expect(await deliveries()).toMatchObject([{ status: 'unknown', errorCode: 'lease_expired' }])
    expect(g.calls).toEqual([])
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'already_used' })
  })

  it('after the Meta request, before the outcome is written: left sending, reaped to unknown, never resent', async () => {
    const h = await dueHandoff('972500000972')
    const g = mockGraph()
    const sendThenDie: typeof sendOwnerReminder = async (input) => {
      await sendOwnerReminder(input)
      throw new Error('process died after the request')
    }
    await expect(sendOneOffReminder({ conversationId: h.c.id }, { send: sendThenDie })).rejects.toThrow()
    expect(g.calls).toHaveLength(1)
    expect(await deliveries()).toMatchObject([{ status: 'sending' }])
    await liveCronLater()
    expect(await deliveries()).toMatchObject([{ status: 'unknown' }])
    expect(g.calls).toHaveLength(1)
  })
})

