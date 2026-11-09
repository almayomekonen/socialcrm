/**
 * The recipient's 30-a-day limit at the edges of a day. Instants are explicit
 * throughout, so these do not depend on when they run. The day is the
 * Asia/Jerusalem business day of when a reminder FIRES (lib/reminders/limits.ts),
 * and the send gate's counter is the hard limit behind it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { enterDispatch } from '@/db/ownerPersonalReminders/dispatchGate'
import { limitBreached } from '@/db/ownerPersonalReminders/lock'
import { counters, enableDelivery, inboundFrom, insertReminder, resetControls } from './deliveryFixtures'
import { seedOwner, type Owner } from './fixtures'

const SEC = 1000
const MIN = 60 * SEC
/** Midnight between 2026-11-10 and 2026-11-11 in Israel (UTC+2). */
const MIDNIGHT = Date.UTC(2026, 10, 10, 22, 0)

const limit = (o: Owner, atMs: number) =>
  db.transaction((trx) => limitBreached(trx, { id: 0, agencyId: o.agencyId, userId: o.userId, recipientId: o.recipientId }, atMs))

async function fill(o: Owner, n: number, status: 'scheduled' | 'sent', over: { remindAtMs: number; dispatchedAt?: Date }) {
  for (let i = 0; i < n; i++) await insertReminder(o, status, over)
}

let o: Owner
beforeEach(async () => {
  o = await seedOwner('daily-edge')
})
afterEach(async () => {
  await db.raw('TRUNCATE platform_entitlements') // row triggers do not fire on TRUNCATE (test cleanup only)
})
afterAll(async () => {
  await resetControls()
  await db.destroy()
})

describe('the approval limit, at midnight', () => {
  it('30 in the last second of the day fill that day and leave the next one empty', async () => {
    await fill(o, 30, 'scheduled', { remindAtMs: MIDNIGHT - SEC })
    expect(await limit(o, MIDNIGHT - 1)).toBe('daily_limit')
    expect(await limit(o, MIDNIGHT)).toBeNull()
  })

  it('30 at the first instant of the next day do not fill the day before it', async () => {
    await fill(o, 30, 'scheduled', { remindAtMs: MIDNIGHT })
    expect(await limit(o, MIDNIGHT - 1)).toBeNull()
    expect(await limit(o, MIDNIGHT)).toBe('daily_limit')
  })

  it('29 leave room for one, right up to the boundary', async () => {
    await fill(o, 29, 'scheduled', { remindAtMs: MIDNIGHT - SEC })
    expect(await limit(o, MIDNIGHT - 1)).toBeNull()
  })

  it('a sent reminder counts on the day it was dispatched, not the day it was due', async () => {
    await fill(o, 30, 'sent', { remindAtMs: MIDNIGHT - MIN, dispatchedAt: new Date(MIDNIGHT + MIN) })
    expect(await limit(o, MIDNIGHT - 1)).toBeNull()
    expect(await limit(o, MIDNIGHT)).toBe('daily_limit')
  })

  it('midnight is Israel\'s, not UTC\'s', async () => {
    const utcMidnight = Date.UTC(2026, 10, 11, 0, 0) // 02:00 in Israel, mid-way through one business day
    await fill(o, 30, 'scheduled', { remindAtMs: utcMidnight - MIN })
    expect(await limit(o, utcMidnight + MIN)).toBe('daily_limit')
  })

  it('the 25-hour day when the clocks go back is still one day', async () => {
    const start = Date.UTC(2026, 9, 24, 21, 0) // 2026-10-25 00:00 IDT
    const end = Date.UTC(2026, 9, 25, 22, 0) // 2026-10-26 00:00 IST
    await fill(o, 30, 'scheduled', { remindAtMs: start })
    expect(await limit(o, end - 1)).toBe('daily_limit')
    expect(await limit(o, end)).toBeNull()
  })

  it('the 23-hour day when the clocks go forward ends at its own midnight', async () => {
    const start = Date.UTC(2026, 2, 26, 22, 0) // 2026-03-27 00:00 IST
    const end = Date.UTC(2026, 2, 27, 21, 0) // 2026-03-28 00:00 IDT
    await fill(o, 30, 'scheduled', { remindAtMs: start })
    expect(await limit(o, end - 1)).toBe('daily_limit')
    expect(await limit(o, end)).toBeNull()
  })
})

describe('the send gate, the limit that cannot be bypassed', () => {
  const gate = (r: { id: number; claimToken: string }, nowMs: number) => enterDispatch({ reminderId: r.id, claimToken: r.claimToken, nowMs, exposure: 0 })
  const claimed = (remindAtMs: number) => insertReminder(o, 'claimed', { remindAtMs })

  beforeEach(async () => {
    await enableDelivery({ recipientDailyCap: 3 }, MIDNIGHT - 30 * SEC)
    await inboundFrom(o, MIDNIGHT - 10 * MIN)
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ consentTextVersion: 'v5' })
  })

  it('holds until midnight and resets at midnight', async () => {
    const before = MIDNIGHT - 30 * SEC
    for (let i = 0; i < 3; i++) expect((await gate(await claimed(before), before)).result).toBe('dispatching')
    expect(await gate(await claimed(before), before)).toEqual({ result: 'failed', reason: 'cap_recipient' })
    expect((await gate(await claimed(MIDNIGHT), MIDNIGHT)).result).toBe('dispatching')
  })

  it('spreading reminders across midnight cannot exceed the cap on the day they are sent', async () => {
    const after = MIDNIGHT + 30 * SEC
    const yesterdays = await Promise.all([1, 2, 3].map(() => claimed(MIDNIGHT - MIN)))
    const todays = await Promise.all([1, 2, 3].map(() => claimed(MIDNIGHT)))
    const results = []
    for (const r of [...yesterdays, ...todays]) results.push(await gate(r, after))
    expect(results.filter((r) => r.result === 'dispatching')).toHaveLength(3)
    expect(results.filter((r) => r.result === 'failed' && r.reason === 'cap_recipient')).toHaveLength(3)
    expect((await counters())[`recipient:${o.recipientId}`].reserved).toBe(3)
  })

  it('a founder\'s approval waiver does not reach the send gate', async () => {
    await db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.userId, entitlement: 'founder_unlimited_usage', reason: 'test founder', grantedBy: 'test' })
    const before = MIDNIGHT - 30 * SEC
    for (let i = 0; i < 3; i++) await gate(await claimed(before), before)
    expect(await gate(await claimed(before), before)).toEqual({ result: 'failed', reason: 'cap_recipient' })
  })
})
