/**
 * Reminder Engine Phase 5: the delivery tick, lifecycle, recovery and monitor,
 * against a real database. The Graph sender is ALWAYS a vi.fn() mock: no
 * WhatsApp message is sent from this file. Synthetic data only.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exposureFail = vi.hoisted(() => ({ on: false }))
vi.mock('@/db/ownerPersonalReminders/exposure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/ownerPersonalReminders/exposure')>()
  return { platformExposure: (a: number, b: number) => (exposureFail.on ? Promise.reject(Object.assign(new Error('x'), { code: '57014' })) : actual.platformExposure(a, b)) }
})

import { db } from '@/config/db'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import { runMonitor } from '@/lib/reminders/delivery/monitor'
import { recordSendOutcome } from '@/db/ownerPersonalReminders/lifecycle'
import { isSendingPaused } from '@/db/ownerWhatsappReminders/deliveries'
import type { PlatformTextOutcome } from '@/lib/whatsapp/platform/sendText'
import { enableDelivery, resetControls, readyOwner, insertReminder, row, counters, eventsOf, phoneOf, T } from './deliveryFixtures'

const MIN = 60_000
const ENV = { OWNER_PERSONAL_REMINDERS_SEND_ENABLED: '1', PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000009', PLATFORM_WHATSAPP_ACCESS_TOKEN: 'synthetic-test-token' }
const sends = (o: PlatformTextOutcome) => vi.fn(async (_input: unknown) => o)
const SENT: PlatformTextOutcome = { kind: 'sent', wamid: 'wamid.mock.1' }
let wamidSeq = 0
const sentOnce = () => vi.fn(async (_input: unknown) => ({ kind: 'sent', wamid: `wamid.mock.${++wamidSeq}.${Date.now()}` }) as PlatformTextOutcome)
const tick = (send: ReturnType<typeof vi.fn>, nowMs = Date.now()) => tickPersonalReminders({ send: send as never, nowMs: () => nowMs })
const controls = async () => (await db('platform_whatsapp_send_controls').where({ id: 1 }).first()) as Record<string, unknown>
const allZero = async () => Object.values(await counters()).every((c) => c.reserved === 0 && c.micros === 0)

beforeEach(async () => {
  Object.assign(process.env, ENV)
  exposureFail.on = false
  await enableDelivery()
  // Isolation: nothing left over from other files may be due during these ticks.
  await db(T).whereIn('status', ['scheduled', 'claimed', 'dispatching']).update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: new Date(), finalizedAt: new Date() })
  const longAgo = new Date(Date.now() - 2 * 60 * MIN)
  await db(T).where({ status: 'failed', errorScope: 'account' }).update({ finalizedAt: longAgo })
  await db('owner_whatsapp_reminder_deliveries').where({ status: 'failed', errorScope: 'account' }).update({ updatedAt: longAgo })
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
})
afterAll(async () => {
  await resetControls()
  await db.destroy()
})

describe('sending is disabled by default', () => {
  it('without OWNER_PERSONAL_REMINDERS_SEND_ENABLED=1 it is a dry run: monitor + housekeeping, no send', async () => {
    delete process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED
    const o = await readyOwner('t-dry')
    const r = await insertReminder(o, 'scheduled')
    const send = sends(SENT)
    const s = await tick(send)
    expect(s).toMatchObject({ mode: 'dry_run', due: 1, claimed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect((await row(r.id)).status).toBe('scheduled')
  })

  it('the migration seed (switch off, unapproved values NULL) blocks, naming every missing value', async () => {
    await resetControls()
    const o = await readyOwner('t-seed')
    await insertReminder(o, 'scheduled')
    const send = sends(SENT)
    const s = await tick(send)
    expect(s.mode).toBe('blocked')
    expect(s.blockedBy).toEqual(expect.arrayContaining(['disabled', 'billingTimezone', 'billingCurrency', 'agencyDailyCap', 'remindersMonthlyBudget', 'remindersMonthlyBudgetMicros', 'serviceSoftLimit', 'pricingMaxAgeDays', 'monitor']))
    expect(send).not.toHaveBeenCalled()
  })

  it('missing platform credentials block', async () => {
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
    const s = await tick(sends(SENT))
    expect(s).toMatchObject({ mode: 'blocked', blockedBy: ['platform_credentials'] })
  })
})

describe('Graph outcomes (mocked)', () => {
  it('sent: recorded once with the wamid, reservation kept, never sent again', async () => {
    const o = await readyOwner('t-sent')
    const r = await insertReminder(o, 'scheduled')
    const send = sentOnce()
    expect(await tick(send)).toMatchObject({ mode: 'live', claimed: 1, sent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ toE164: await phoneOf(o), body: 'תזכורת: הגיע הזמן להתקשר לאבי.', jobId: r.id, accessToken: 'synthetic-test-token' })
    expect(await row(r.id)).toMatchObject({ status: 'sent', attempts: 1 })
    expect((await row(r.id)).wamid).toMatch(/^wamid\.mock\./)
    expect((await counters())[`recipient:${o.recipientId}`].reserved).toBe(1)
    await tick(send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('timeout → unknown: reservation kept, never resent', async () => {
    const o = await readyOwner('t-unknown')
    const r = await insertReminder(o, 'scheduled')
    const send = sends({ kind: 'unknown', reason: 'timeout' })
    expect(await tick(send)).toMatchObject({ unknown: 1 })
    expect(await row(r.id)).toMatchObject({ status: 'unknown' })
    expect(await allZero()).toBe(false)
    await tick(send)
    await tick(send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  const definite: [string, PlatformTextOutcome, string][] = [
    ['recipient rejection', { kind: 'rejected', scope: 'recipient', code: '131026', httpStatus: 400 }, 'recipient_rejected'],
    ['window error 131047', { kind: 'rejected', scope: 'other', code: '131047', httpStatus: 400 }, 'window_closed'],
    ['other rejection', { kind: 'rejected', scope: 'other', code: null, httpStatus: 400 }, 'other'],
  ]
  for (const [name, outcome, reason] of definite) {
    it(`${name} → failed ${reason}, every reservation released`, async () => {
      const o = await readyOwner(`t-${reason}`)
      const r = await insertReminder(o, 'scheduled')
      await tick(sends(outcome))
      expect(await row(r.id)).toMatchObject({ status: 'failed', failureReason: reason })
      expect((await row(r.id)).costReleasedAt).not.toBeNull()
      expect(await allZero()).toBe(true)
      expect((await eventsOf(r.id)).map((e) => e.type)).toEqual(['dispatched', 'failed', 'cost_released'])
    })
  }

  it('rate limit: released and retried at 1, 5, 15 minutes, then failed rate_limited', async () => {
    const o = await readyOwner('t-rate')
    const r = await insertReminder(o, 'scheduled')
    const send = sends({ kind: 'rejected', scope: 'rate_limit', code: '131056', httpStatus: 429 })
    const t0 = Date.now()
    await tick(send, t0)
    expect(await row(r.id)).toMatchObject({ status: 'scheduled', errorScope: 'rate_limit', dispatchedAt: null, reservedMicros: null })
    expect(new Date((await row(r.id)).nextAttemptAt as string).getTime()).toBe(t0 + MIN)
    expect(await allZero()).toBe(true)
    await tick(send, t0 + MIN + 1)
    await tick(send, t0 + 7 * MIN)
    expect((await row(r.id)).status).toBe('scheduled')
    await tick(send, t0 + 23 * MIN)
    expect(await row(r.id)).toMatchObject({ status: 'failed', failureReason: 'rate_limited', attempts: 4 })
    expect(send).toHaveBeenCalledTimes(4)
    expect(await allZero()).toBe(true)
  })

  it('an account rejection pauses BOTH owner-reminder systems', async () => {
    const o = await readyOwner('t-account')
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'rejected', scope: 'account', code: '131042', httpStatus: 400 }))
    expect(await row(r.id)).toMatchObject({ status: 'failed', failureReason: 'account_rejected' })
    expect(await isSendingPaused(new Date())).toBe(true)
    await insertReminder(o, 'scheduled')
    const send = sends(SENT)
    expect(await tick(send)).toMatchObject({ mode: 'blocked', blockedBy: ['account_paused'] })
    expect(send).not.toHaveBeenCalled()
  })

  it('an outcome is recorded only once, for the claim that dispatched', async () => {
    const o = await readyOwner('t-dupe')
    const r = await insertReminder(o, 'dispatching')
    expect(await recordSendOutcome({ reminderId: r.id, claimToken: r.claimToken, outcome: SENT, nowMs: Date.now() })).toBe('sent')
    expect(await recordSendOutcome({ reminderId: r.id, claimToken: r.claimToken, outcome: { kind: 'unknown', reason: 'timeout' }, nowMs: Date.now() })).toBe('not_dispatching')
    expect((await row(r.id)).status).toBe('sent')
  })
})

describe('consent and opt-out are re-checked at dispatch', () => {
  it('opted out or withdrawn after scheduling → cancelled, never sent', async () => {
    const a = await readyOwner('t-optout')
    const ra = await insertReminder(a, 'scheduled')
    await db('owner_whatsapp_recipients').where({ id: a.recipientId }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'keyword' })
    const b = await readyOwner('t-withdrawn')
    const rb = await insertReminder(b, 'scheduled')
    await db('owner_whatsapp_recipients').where({ id: b.recipientId }).update({ consentTextVersion: 'v4' })
    const send = sends(SENT)
    expect(await tick(send)).toMatchObject({ cancelled: 2, sent: 0 })
    expect(await row(ra.id)).toMatchObject({ status: 'cancelled', cancelReason: 'opted_out' })
    expect(await row(rb.id)).toMatchObject({ status: 'cancelled', cancelReason: 'consent_withdrawn' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('crash recovery', () => {
  it('a claim abandoned past its lease is returned and then delivered once', async () => {
    const o = await readyOwner('t-stale-claim')
    const r = await insertReminder(o, 'claimed', { claimedAt: new Date(Date.now() - 3 * MIN) })
    const send = sentOnce()
    await tick(send)
    expect((await row(r.id)).status).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a dispatch abandoned past its lease becomes unknown and is NEVER resent', async () => {
    const o = await readyOwner('t-stale-dispatch')
    const r = await insertReminder(o, 'dispatching', { dispatchedAt: new Date(Date.now() - 3 * MIN) })
    const send = sends(SENT)
    await tick(send)
    await tick(send)
    expect((await row(r.id)).status).toBe('unknown')
    expect(await eventsOf(r.id)).toEqual([{ type: 'unknown', reason: 'lease_expired' }])
    expect(send).not.toHaveBeenCalled()
    expect(await recordSendOutcome({ reminderId: r.id, claimToken: r.claimToken, outcome: SENT, nowMs: Date.now() })).toBe('not_dispatching')
  })

  it('a later Meta `failed` status releases the reservation exactly once', async () => {
    const o = await readyOwner('t-meta-failed')
    const r = await insertReminder(o, 'scheduled')
    await tick(sentOnce())
    const wamid = (await row(r.id)).wamid as string
    await db('owner_whatsapp_message_status').insert({ wamid, status: 'failed', failedAt: new Date(), errorCode: '131049' })
    await tick(sends(SENT))
    await tick(sends(SENT))
    expect(await allZero()).toBe(true)
    expect((await eventsOf(r.id)).filter((e) => e.type === 'cost_released')).toHaveLength(1)
  })

  it('reminder text is purged 90 days after a terminal state', async () => {
    const o = await readyOwner('t-purge')
    const old = Date.now() - 92 * 24 * 60 * MIN
    const r = await insertReminder(o, 'sent', { remindAtMs: old, finalizedAt: new Date(old), sentAt: new Date(old), dispatchedAt: new Date(old) })
    await tick(sends(SENT))
    expect(await row(r.id)).toMatchObject({ text: null })
    expect((await row(r.id)).textPurgedAt).not.toBeNull()
  })
})

describe('the exposure monitor and heartbeat', () => {
  it('unconfigured or failing: no heartbeat, so the gate fails closed', async () => {
    await enableDelivery({ billingTimezone: null, monitorLastRunAt: null })
    expect(await runMonitor(Date.now())).toMatchObject({ state: 'unconfigured', exposure: null })
    expect((await controls()).monitorLastRunAt).toBeNull()
    await enableDelivery({ monitorLastRunAt: null })
    exposureFail.on = true
    expect(await runMonitor(Date.now())).toMatchObject({ state: 'error', exposure: null })
    expect((await controls()).monitorLastRunAt).toBeNull()
    const o = await readyOwner('t-monitor-down')
    await insertReminder(o, 'scheduled')
    const send = sends(SENT)
    expect(await tick(send)).toMatchObject({ mode: 'blocked', blockedBy: ['monitor'] })
    expect(send).not.toHaveBeenCalled()
  })

  it('ok: writes the heartbeat', async () => {
    await enableDelivery({ monitorLastRunAt: null })
    const now = Date.now()
    expect((await runMonitor(now)).state).toBe('ok')
    expect(new Date((await controls()).monitorLastRunAt as string).getTime()).toBe(now)
  })

  it('at the emergency limit the kill switch trips, stays tripped, and blocks sending', async () => {
    const o = await readyOwner('t-emergency')
    await insertReminder(o, 'dispatching')
    await enableDelivery({ serviceSoftLimit: 1, serviceEmergencyLimit: 1 })
    const first = Date.now()
    expect(await runMonitor(first)).toMatchObject({ state: 'ok', tripped: true })
    const c = await controls()
    expect(c.trippedReason).toBe('service_month_emergency')
    await runMonitor(first + MIN)
    expect(new Date((await controls()).trippedAt as string).getTime()).toBe(new Date(c.trippedAt as string).getTime())
    await insertReminder(o, 'scheduled')
    const send = sends(SENT)
    expect((await tick(send)).blockedBy).toContain('kill_switch')
    expect(send).not.toHaveBeenCalled()
  })
})
