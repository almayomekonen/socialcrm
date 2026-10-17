import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { ONE_OFF_AGENCY_ID, sendOneOffReminder } from '@/lib/ownerWhatsappReminders/oneOffSend'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { MIN, ago, agency, cleanup, clearEnv, conversation, deliveries, escalate, mockGraph, recipient, resetBetweenTests, sentTo, setLiveEnv, user } from './reminderFixtures'
import { dueHandoff, json, liveCronLater, setOneOffEnv, stop } from './oneOffFixtures'

/** The one-off's `immediate` test mode. The cron and the standard one-off keep 120 minutes. */
const A = ONE_OFF_AGENCY_ID
let B: number

beforeAll(async () => {
  await agency('__owr_oneoff_103__', A)
  B = await agency('__owr_oneoff_imm_b__')
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

describe('immediate mode (test only): 1-minute minimum wait, the wait stated in minutes', () => {
  const bodyText = (call: { body: any }) => call.body.template.components[0].parameters[0].text

  it('sends after 1 minute, with the true wait in the approved template variable', async () => {
    const h = await dueHandoff('972500000981', { escalatedAgo: 5 * MIN + 10_000 })
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toMatchObject({ outcome: 'sent' })
    expect(g.calls).toHaveLength(1)
    expect(sentTo(g.calls)).toEqual(['972500000981'])
    expect(g.calls[0].body.template.name).toBe('lead_followup_alert')
    expect(bodyText(g.calls[0])).toBe('5 דקות')
    expect(await deliveries()).toMatchObject([{ status: 'sent', attempts: 1 }])
  })

  it('refuses a hand-off under 1 minute old', async () => {
    const h = await dueHandoff('972500000982', { escalatedAgo: 20_000 })
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'conversation_not_eligible' })
    expect(g.calls).toEqual([])
  })

  it('the standard one-off and the cron still require 120 minutes', async () => {
    const h = await dueHandoff('972500000983', { escalatedAgo: 5 * MIN })
    const g = mockGraph()
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'conversation_not_eligible' })
    setLiveEnv([A])
    const tick = await tickOwnerWhatsappReminders()
    expect(tick.candidates).toBe(0)
    expect(g.calls).toEqual([])
    expect(await deliveries()).toEqual([])
  })

  it('keeps every other rule: other agency, other recipient, revoked consent, recipient verified after the hand-off', async () => {
    const h = await dueHandoff('972500000984', { escalatedAgo: 5 * MIN })
    const g = mockGraph()
    const foreign = await conversation(B, { lead: false })
    await escalate(foreign, ago(5 * MIN))
    expect(await sendOneOffReminder({ conversationId: foreign.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'conversation_not_eligible' })
    process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = String(await recipient(B, await user(B), '972500000985'))
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'recipient_not_active' })
    setOneOffEnv(h.recipientId)
    expect(await stop('972500000984')).toBe('opted_out')
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'recipient_not_active' })
    await resetBetweenTests()
    const late = await dueHandoff('972500000986', { escalatedAgo: 5 * MIN, verifiedAt: new Date() })
    expect(await sendOneOffReminder({ conversationId: late.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'recipient_not_selected' })
    expect(g.calls).toEqual([])
  })

  it('single use across modes, and concurrent immediate calls make one request', async () => {
    const h = await dueHandoff('972500000987', { escalatedAgo: 5 * MIN })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const g = mockGraph(async () => {
      await gate
      return json({ messages: [{ id: 'wamid.IMMEDIATE' }] }, 200)
    })
    const both = Promise.all([sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' }), sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })])
    await vi.waitFor(() => expect(g.calls).toHaveLength(1), { timeout: 5000 })
    release()
    expect((await both).map((r) => r.outcome).sort()).toEqual(['refused', 'sent'])
    expect(await sendOneOffReminder({ conversationId: h.c.id })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toHaveLength(1)
  })

  it('an ambiguous outcome is unknown, never retried, never sent by the cron', async () => {
    const h = await dueHandoff('972500000988', { escalatedAgo: 5 * MIN })
    const g = mockGraph(() => json({ error: { code: 1 } }, 502))
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toMatchObject({ outcome: 'unknown', reason: 'server_error' })
    await liveCronLater()
    expect(await sendOneOffReminder({ conversationId: h.c.id, mode: 'immediate' })).toEqual({ outcome: 'refused', reason: 'already_used' })
    expect(g.calls).toHaveLength(1)
    expect(await deliveries()).toMatchObject([{ status: 'unknown' }])
  })
})
