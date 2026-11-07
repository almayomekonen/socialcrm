import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The owner is never promised a WhatsApp message the system cannot send.
 * While automatic delivery is unavailable (production 2026-11-07: sending switch
 * off), the card and the confirmation say the reminder is saved in SocialCRM and
 * that no message will come. When delivery is available, the card promises it.
 * Availability is read through the REAL switches (environment + controls row);
 * nothing is sent: the delivery tick never runs here.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { DELIVERY_OFF, DELIVERY_ON, SAVED_DELIVERY_OFF } from '@/lib/waAssistant/reminders/copy'
import { enableDelivery, resetControls } from '../reminders/deliveryFixtures'
import { agencies, card, harness, owner, press, reset, setEnv, teardown } from './reminderHarness'

let A: number

beforeAll(async () => {
  ;[A] = await agencies('__rm_wording_a__')
})
beforeEach(async () => {
  await reset([A])
  setEnv([A])
  await resetControls()
})
afterEach(async () => {
  delete process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED
  await resetControls()
})
afterAll(async () => {
  await teardown()
})

describe('delivery unavailable (the production state today)', () => {
  it('the card says it is saved and that no automatic message will come; the confirmation repeats it', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    expect(c.body).toContain(DELIVERY_OFF)
    expect(c.body).not.toContain(DELIVERY_ON)
    const done = (await press(o, h, c.approve)).body
    expect(done).toContain('*התזכורת נקבעה*')
    expect(done).toContain(SAVED_DELIVERY_OFF)
  })

  it('a rescheduled reminder says the same; a cancellation does not mention delivery', async () => {
    const o = await owner(A)
    const h = harness()
    await press(o, h, (await card(o, h, 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).approve)
    const moved = (await press(o, h, (await card(o, h, 'תזיז את התזכורת להתקשר לאבי בעוד 30 דקות')).approve)).body
    expect(moved).toContain('*התזכורת הוזזה*')
    expect(moved).toContain(SAVED_DELIVERY_OFF)
    const cancelled = (await press(o, h, (await card(o, h, 'תבטל את התזכורת להתקשר לאבי')).approve)).body
    expect(cancelled).toContain('*התזכורת בוטלה*')
    expect(cancelled).not.toContain(SAVED_DELIVERY_OFF)
  })

  it.each([
    ['environment switch on, database switch off', { remindersEnabled: false }],
    ['kill switch tripped', { trippedAt: new Date(), trippedReason: 'test' }],
    ['a control not configured', { agencyDailyCap: null }],
  ])('%s → still no promise', async (_name, over) => {
    process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED = '1'
    await enableDelivery(over)
    const o = await owner(A)
    expect((await card(o, harness(), 'בעוד 5 דקות תזכיר לי להתקשר לאבי')).body).toContain(DELIVERY_OFF)
  })

  it('names no switch, flag or setting', () => {
    for (const s of [DELIVERY_OFF, SAVED_DELIVERY_OFF]) expect(s).not.toMatch(/[A-Z_]{4,}|flag|env|cron|דגל|הגדר/u)
  })
})

describe('delivery available', () => {
  it('every switch on and configured → the card promises the message; the confirmation adds no caveat', async () => {
    process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED = '1'
    await enableDelivery()
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    expect(c.body).toContain(DELIVERY_ON)
    expect(c.body).not.toContain(DELIVERY_OFF)
    const done = (await press(o, h, c.approve)).body
    expect(done).toContain('*התזכורת נקבעה*')
    expect(done).not.toContain(SAVED_DELIVERY_OFF)
    // Wording only: nothing was claimed or sent.
    expect(await db('owner_personal_reminders').where({ agencyId: A }).first('status', 'claimedAt')).toEqual({ status: 'scheduled', claimedAt: null })
  })
})
