import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WA_ASSISTANT_REMINDERS_AUDIENCE=all: who is OFFERED reminders widens; every
 * per-recipient protection stays. Real gate and worker, mock sender and Agent:
 * nothing reaches Meta or a model.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))

import { db } from '@/config/db'
import { isWaAssistantRemindersAgency } from '@/lib/flags/waAssistantFlags'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import type { PlatformTextOutcome } from '@/lib/whatsapp/platform/sendText'
import { enableDelivery, resetControls, readyOwner, insertReminder, row, T } from '../reminders/deliveryFixtures'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

const KEYS = ['WA_ASSISTANT_AUDIENCE', 'WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_EXCLUDED_AGENCY_IDS', 'WA_ASSISTANT_REMINDERS_AGENCY_IDS', 'WA_ASSISTANT_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_PERSONAL_REMINDERS_SEND_ENABLED', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN']
const clear = () => KEYS.forEach((k) => delete process.env[k])
const everyone = () => {
  process.env.WA_ASSISTANT_AUDIENCE = 'all'
  process.env.WA_ASSISTANT_REMINDERS_AUDIENCE = 'all'
  process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
}

describe('who is offered reminders', () => {
  afterEach(clear)

  it('by default nobody; the explicit list works exactly as before', () => {
    expect(isWaAssistantRemindersAgency(103)).toBe(false)
    process.env.WA_ASSISTANT_AGENCY_IDS = '103,7'
    process.env.WA_ASSISTANT_REMINDERS_AGENCY_IDS = '103'
    expect(isWaAssistantRemindersAgency(103)).toBe(true)
    expect(isWaAssistantRemindersAgency(7)).toBe(false)
  })

  it('`all` covers every agency in the assistant audience, including one created later', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_REMINDERS_AUDIENCE = 'all'
    for (const id of [103, 23, 999_999]) expect(isWaAssistantRemindersAgency(id)).toBe(true)
  })

  it('it never reaches beyond the assistant audience', () => {
    process.env.WA_ASSISTANT_AGENCY_IDS = '103'
    process.env.WA_ASSISTANT_REMINDERS_AUDIENCE = 'all'
    expect(isWaAssistantRemindersAgency(103)).toBe(true)
    expect(isWaAssistantRemindersAgency(7)).toBe(false)
  })

  it('an excluded agency stays out, in both modes', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS = '7'
    process.env.WA_ASSISTANT_REMINDERS_AUDIENCE = 'all'
    expect(isWaAssistantRemindersAgency(7)).toBe(false)
    expect(isWaAssistantRemindersAgency(8)).toBe(true)
  })

  it.each(['ALL', 'true', '*', '1', ''])('only the exact value `all` opens it: %j does not', (value) => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_REMINDERS_AUDIENCE = value
    expect(isWaAssistantRemindersAgency(7)).toBe(false)
  })
})

describe('with the audience open to everyone', () => {
  const sent = vi.fn(async (): Promise<PlatformTextOutcome> => ({ kind: 'sent', wamid: `wamid.ra.${Date.now()}.${Math.random()}` }))
  const tick = () => tickPersonalReminders({ send: sent as never, nowMs: () => Date.now() })
  let seq = 0

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  beforeEach(async () => {
    clear()
    everyone()
    process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED = '1'
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
    sent.mockClear()
    await enableDelivery()
    await db(T).whereIn('status', ['scheduled', 'claimed', 'dispatching']).update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: new Date(), finalizedAt: new Date() })
  })
  afterAll(async () => {
    clear()
    vi.restoreAllMocks()
    await resetControls()
    await db('wa_assistant_jobs').del()
    await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
    await cleanup()
  })

  it('a reminder with full consent still goes out, once', async () => {
    const o = await readyOwner('ra-ok')
    const r = await insertReminder(o, 'scheduled')
    await tick()
    await tick()
    expect(sent).toHaveBeenCalledTimes(1)
    expect((await row(r.id)).status).toBe('sent')
  })

  it('consent below v5 is cancelled and never sent', async () => {
    const o = await readyOwner('ra-v4')
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ consentTextVersion: 'v4' })
    const r = await insertReminder(o, 'scheduled')
    await tick()
    expect(sent).not.toHaveBeenCalled()
    expect(await row(r.id)).toMatchObject({ status: 'cancelled', cancelReason: 'consent_withdrawn' })
  })

  it('an opted-out recipient is never sent to', async () => {
    const o = await readyOwner('ra-out')
    const r = await insertReminder(o, 'scheduled')
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ status: 'opted_out' })
    await tick()
    expect(sent).not.toHaveBeenCalled()
    expect(await row(r.id)).toMatchObject({ status: 'cancelled', cancelReason: 'opted_out' })
  })

  it('a closed 24-hour window is refused', async () => {
    const o = await readyOwner('ra-window')
    await db('platform_whatsapp_inbound').where('messageTimestamp', '>', 0).update({ messageTimestamp: Math.floor(Date.now() / 1000) - 30 * 3600 })
    const r = await insertReminder(o, 'scheduled')
    await tick()
    expect(sent).not.toHaveBeenCalled()
    expect((await row(r.id)).failureReason).toBe('window_closed')
  })

  it('capacity limits still hold', async () => {
    await enableDelivery({ agencyDailyCap: 1 })
    const o = await readyOwner('ra-cap')
    await insertReminder(o, 'scheduled')
    const second = await insertReminder(o, 'scheduled')
    await tick()
    await tick()
    expect(sent).toHaveBeenCalledTimes(1)
    expect((await row(second.id)).failureReason).toBe('cap_agency')
  })

  it('the kill switch and a stale heartbeat stop every send', async () => {
    const o = await readyOwner('ra-kill')
    const r = await insertReminder(o, 'scheduled')
    await db('platform_whatsapp_send_controls').where({ id: 1 }).update({ trippedAt: new Date(), trippedReason: 'test' })
    await tick()
    expect(sent).not.toHaveBeenCalled()
    expect((await row(r.id)).status).toBe('scheduled')
    await db('platform_whatsapp_send_controls').where({ id: 1 }).update({ trippedAt: null, trippedReason: null, remindersEnabled: false })
    await tick()
    expect(sent).not.toHaveBeenCalled()
    expect((await row(r.id)).status).toBe('scheduled')
  })

  it('on WhatsApp, an agency never listed gets the consent prompt and no reminder is created', async () => {
    flags.agent = true
    const A = await agency(`__ra_new_${Date.now()}`)
    await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: 'manual:test' })
    const digits = `9725000${Math.floor(1e5 + Math.random() * 8e5)}`
    const u = await user(A, 'ADMIN')
    await recipient(A, u, digits, undefined, 'v4')
    const runAgent = vi.fn(async () => ({ ok: false, reason: 'gate_denied' }) as never)
    const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.RA_${++seq}` }))
    expect(await processPlatformMessage({ id: `wamid.__ra_${++seq}_${Date.now()}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'בעוד 5 דקות תזכיר לי להתקשר לאבי' } })).toBe('assistant_queued')
    await runWaAssistantWorker({}, { runAgent: runAgent as never, sendText: sendText as never, typing: vi.fn(async () => undefined) as never })
    expect(runAgent).not.toHaveBeenCalled()
    expect(sendText.mock.calls[0][0].body).toBe(REMINDER_COPY.consent)
    expect(await db(T).where({ agencyId: A })).toEqual([])
  })
})

