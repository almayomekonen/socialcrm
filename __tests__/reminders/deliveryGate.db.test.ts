/**
 * Reminder Engine Phase 5: the full send gate (T2), against a real database.
 * Synthetic data only; no Graph call is made anywhere in this file.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { enterDispatch } from '@/db/ownerPersonalReminders/dispatchGate'
import { claimDueReminders } from '@/db/ownerPersonalReminders/lifecycle'
import { enableDelivery, resetControls, readyOwner, insertReminder, inboundFrom, row, counters, eventsOf, T, TEST_PRICE_MICROS } from './deliveryFixtures'
import { seedOwner } from './fixtures'

const MIN = 60_000
const HOUR = 60 * MIN
const gate = (r: { id: number; claimToken: string }, over: { nowMs?: number; exposure?: number | null } = {}) =>
  enterDispatch({ reminderId: r.id, claimToken: r.claimToken, nowMs: over.nowMs ?? Date.now(), exposure: 'exposure' in over ? over.exposure : 0 })

beforeEach(async () => {
  await enableDelivery()
  // The pause test's account rejection would otherwise pause every later gate for an hour.
  await db(T).where({ status: 'failed', errorScope: 'account' }).update({ finalizedAt: new Date(Date.now() - 2 * HOUR) })
})
afterAll(async () => {
  await resetControls()
  await db.destroy()
})

describe('the happy path', () => {
  it('v5, verified window, configured controls → dispatching, every scope reserved once, a dispatched event', async () => {
    const o = await readyOwner('g-ok')
    const r = await insertReminder(o, 'claimed')
    const g = await gate(r)
    expect(g).toMatchObject({ result: 'dispatching', body: 'תזכורת: הגיע הזמן להתקשר לאבי.', priceMicros: TEST_PRICE_MICROS })
    expect(await row(r.id)).toMatchObject({ status: 'dispatching', channel: 'text', reservedMicros: String(TEST_PRICE_MICROS) })
    const c = await counters()
    expect(c['reminders_month:0']).toEqual({ reserved: 1, micros: 0 })
    expect(c['reminders_month_cost:0']).toEqual({ reserved: 0, micros: TEST_PRICE_MICROS })
    expect(c[`agency:${o.agencyId}`].reserved).toBe(1)
    expect(c[`recipient:${o.recipientId}`].reserved).toBe(1)
    expect((await eventsOf(r.id)).map((e) => e.type)).toEqual(['dispatched'])
  })

  it('more than 5 minutes late names the original time; within 60 minutes it still goes', async () => {
    const o = await readyOwner('g-late')
    const r = await insertReminder(o, 'claimed', { remindAtMs: Date.now() - 10 * MIN })
    const g = await gate(r)
    expect(g.result).toBe('dispatching')
    expect(g.result === 'dispatching' && g.body).toMatch(/^תזכורת: הגיע הזמן להתקשר לאבי\. \(נקבעה ל-\d{2}:\d{2}\)$/)
  })
})

describe('operational controls hand the claim back unsent', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['DB switch off', { remindersEnabled: false }, 'disabled'],
    ['kill switch tripped', { trippedAt: new Date(), trippedReason: 'test' }, 'kill_switch'],
    ['an unapproved value is NULL', { agencyDailyCap: null }, 'unconfigured'],
    ['billing currency unknown', { billingCurrency: null }, 'unconfigured'],
    ['monitor heartbeat stale', { monitorLastRunAt: new Date(Date.now() - 6 * MIN) }, 'monitor_stale'],
    ['monitor never ran', { monitorLastRunAt: null }, 'monitor_stale'],
  ]
  for (const [name, over, reason] of cases) {
    it(`${name} → deferred ${reason}`, async () => {
      await enableDelivery(over)
      const o = await readyOwner(`g-defer-${reason}`)
      const r = await insertReminder(o, 'claimed', { attempts: 1 })
      expect(await gate(r)).toEqual({ result: 'deferred', reason })
      expect(await row(r.id)).toMatchObject({ status: 'scheduled', claimToken: null, claimedAt: null, attempts: 0, dispatchedAt: null })
      expect(await counters()).toEqual({})
    })
  }

  it('an account-scope rejection on EITHER owner-reminder system pauses this one', async () => {
    const o = await readyOwner('g-paused')
    const failed = await insertReminder(o, 'dispatching')
    await db(T).where({ id: failed.id }).update({ status: 'failed', failureReason: 'account_rejected', errorScope: 'account', finalizedAt: new Date() })
    const r = await insertReminder(o, 'claimed')
    expect(await gate(r)).toEqual({ result: 'deferred', reason: 'account_paused' })
  })

  it('exposure not measured → deferred; at the soft limit → failed cap_platform_month', async () => {
    const o = await readyOwner('g-exposure')
    const a = await insertReminder(o, 'claimed')
    expect(await gate(a, { exposure: null })).toEqual({ result: 'deferred', reason: 'exposure_unknown' })
    const b = await insertReminder(o, 'claimed')
    expect(await gate(b, { exposure: 900 })).toEqual({ result: 'failed', reason: 'cap_platform_month' })
  })
})

describe('lateness and the 24-hour window', () => {
  it('more than 60 minutes late → failed too_late, nothing reserved', async () => {
    const o = await readyOwner('g-too-late')
    const r = await insertReminder(o, 'claimed', { remindAtMs: Date.now() - 61 * MIN })
    expect(await gate(r)).toEqual({ result: 'failed', reason: 'too_late' })
    expect(await row(r.id)).toMatchObject({ status: 'failed', failureReason: 'too_late' })
    expect(await counters()).toEqual({})
  })

  it('only VERIFIED Meta timestamps open the window', async () => {
    const o = await seedOwner('g-unverified')
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ consentTextVersion: 'v5' })
    await inboundFrom(o, Date.now() - MIN, 'server')
    await inboundFrom(o, Date.now() - MIN, null)
    const r = await insertReminder(o, 'claimed')
    expect(await gate(r)).toEqual({ result: 'failed', reason: 'unverified_window' })
  })

  it('the last verified message more than 23 hours ago → failed window_closed', async () => {
    const o = await seedOwner('g-window')
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ consentTextVersion: 'v5' })
    await inboundFrom(o, Date.now() - 23 * HOUR - MIN)
    const r = await insertReminder(o, 'claimed')
    expect(await gate(r)).toEqual({ result: 'failed', reason: 'window_closed' })
  })
})

describe('pricing fails closed', () => {
  it('no rate for the currency, a stale verification, or a rate not yet effective → pricing_unavailable', async () => {
    const o = await readyOwner('g-pricing')
    for (const over of [{ currency: 'EUR' }, { verifiedAt: new Date(Date.now() - 31 * 24 * HOUR) }, { effectiveFrom: '2099-01-01' }]) {
      await db('platform_whatsapp_rate_cards').update(over)
      const r = await insertReminder(o, 'claimed')
      expect(await gate(r)).toEqual({ result: 'failed', reason: 'pricing_unavailable' })
      expect((await eventsOf(r.id)).map((e) => e.type)).toEqual(['pricing_unavailable'])
      await enableDelivery()
    }
  })
})

describe('capacity: atomic, all or nothing, never exceeded under concurrency', () => {
  it('a full recipient scope fails cap_recipient and undoes the earlier scopes', async () => {
    await enableDelivery({ recipientDailyCap: 1 })
    const o = await readyOwner('g-cap-recipient')
    expect((await gate(await insertReminder(o, 'claimed'))).result).toBe('dispatching')
    const second = await insertReminder(o, 'claimed')
    expect(await gate(second)).toEqual({ result: 'failed', reason: 'cap_recipient' })
    const c = await counters()
    expect(c['platform:0'].reserved).toBe(1)
    expect(c['reminders_month_cost:0'].micros).toBe(TEST_PRICE_MICROS)
    expect(await eventsOf(second.id)).toEqual([{ type: 'capacity_denied', reason: 'cap_recipient' }])
  })

  it('the monthly cost budget is checked in micros', async () => {
    await enableDelivery({ remindersMonthlyBudgetMicros: TEST_PRICE_MICROS + 1 })
    const o = await readyOwner('g-cap-cost')
    expect((await gate(await insertReminder(o, 'claimed'))).result).toBe('dispatching')
    expect(await gate(await insertReminder(o, 'claimed'))).toEqual({ result: 'failed', reason: 'cap_reminders_month' })
  })

  it('eight concurrent gates against a platform cap of 3: exactly 3 dispatch', async () => {
    await enableDelivery({ platformDailyCap: 3 })
    const owners = await Promise.all([...Array(8)].map((_, i) => readyOwner(`g-race-${i}`)))
    const rs = await Promise.all(owners.map((o) => insertReminder(o, 'claimed')))
    const results = await Promise.all(rs.map((r) => gate(r)))
    expect(results.filter((g) => g.result === 'dispatching')).toHaveLength(3)
    expect(results.filter((g) => g.result === 'failed' && g.reason === 'cap_platform')).toHaveLength(5)
    expect((await counters())['platform:0'].reserved).toBe(3)
  })

  it('concurrent claimers never take the same reminder', async () => {
    const o = await readyOwner('g-claim-race')
    await db(T).where({ status: 'scheduled' }).update({ nextAttemptAt: new Date(Date.now() + HOUR) })
    const ids = await Promise.all([...Array(6)].map(() => insertReminder(o, 'scheduled', { remindAtMs: Date.now() - MIN })))
    const mine = new Set(ids.map((r) => r.id))
    const [a, b, c] = await Promise.all([claimDueReminders(Date.now(), 3), claimDueReminders(Date.now(), 3), claimDueReminders(Date.now(), 3)])
    const taken = [...a, ...b, ...c].map((x) => x.id).filter((id) => mine.has(id))
    expect(new Set(taken).size).toBe(taken.length)
    expect(taken.length).toBe(6)
  })

  it('a stale or foreign claim token never dispatches', async () => {
    const o = await readyOwner('g-token')
    const r = await insertReminder(o, 'claimed')
    expect(await gate({ id: r.id, claimToken: '00000000-0000-4000-8000-000000000001' })).toEqual({ result: 'not_claimed', status: 'claimed' })
    expect((await gate(r)).result).toBe('dispatching')
    expect(await gate(r)).toEqual({ result: 'not_claimed', status: 'dispatching' })
    expect((await counters())['platform:0'].reserved).toBe(1)
  })
})
