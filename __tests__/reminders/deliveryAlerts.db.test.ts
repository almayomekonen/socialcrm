/**
 * Operational alerts for personal-reminder delivery (lib/reminders/delivery/alerts.ts):
 * every failed, ambiguous, refused or blocked send leaves ONE structured alert line
 * an operator can monitor, with ids and codes only. The Graph sender is always a
 * mock; no WhatsApp message is sent. Synthetic data only.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateOverride = vi.hoisted(() => ({ result: null as null | { result: 'deferred'; reason: string } }))
vi.mock('@/db/ownerPersonalReminders/dispatchGate', async (orig) => {
  const actual = await orig<typeof import('@/db/ownerPersonalReminders/dispatchGate')>()
  return { ...actual, enterDispatch: async (i: Parameters<typeof actual.enterDispatch>[0]) => gateOverride.result ?? actual.enterDispatch(i) }
})
import { db } from '@/config/db'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import { ALERT_PREFIX } from '@/lib/reminders/delivery/alerts'
import type { PlatformTextOutcome } from '@/lib/whatsapp/platform/sendText'
import { enableDelivery, resetControls, readyOwner, insertReminder, phoneOf, T } from './deliveryFixtures'

const MIN = 60_000
const ENV = { OWNER_PERSONAL_REMINDERS_SEND_ENABLED: '1', PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000009', PLATFORM_WHATSAPP_ACCESS_TOKEN: 'synthetic-test-token' }
const sends = (o: PlatformTextOutcome) => vi.fn(async (_i: unknown) => o)
const tick = (send: ReturnType<typeof vi.fn>, nowMs = Date.now()) => tickPersonalReminders({ send: send as never, nowMs: () => nowMs })

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
const alerts = () =>
  [...errorSpy.mock.calls, ...warnSpy.mock.calls]
    .filter((c) => String(c[0]).startsWith(ALERT_PREFIX))
    .map((c) => ({ kind: String(c[0]).slice(ALERT_PREFIX.length + 1), fields: c[1] as Record<string, unknown> }))

beforeEach(async () => {
  Object.assign(process.env, ENV)
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await enableDelivery()
  await db(T).whereIn('status', ['scheduled', 'claimed', 'dispatching']).update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: new Date(), finalizedAt: new Date() })
  await db(T).where({ status: 'failed', errorScope: 'account' }).update({ finalizedAt: new Date(Date.now() - 2 * 60 * MIN) })
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})
afterAll(async () => {
  await resetControls()
  await db.destroy()
})

describe('each abnormal outcome raises one alert, with ids and codes only', () => {
  it('a Meta rejection → send_failed (scope and code), never the text or the number', async () => {
    const o = await readyOwner('al-failed')
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'rejected', scope: 'recipient', code: '131026', httpStatus: 400 }))
    expect(alerts()).toEqual([{ kind: 'send_failed', fields: { reminderId: r.id, scope: 'recipient', code: '131026' } }])
    const logged = JSON.stringify(alerts())
    expect(logged).not.toContain('להתקשר')
    expect(logged).not.toContain((await phoneOf(o)).replace(/\D/g, '').slice(-7))
  })

  it('an ambiguous outcome → send_unknown; a dispatch past its lease → send_unknown (lease_expired)', async () => {
    const o = await readyOwner('al-unknown')
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'unknown', reason: 'timeout' }))
    expect(alerts()).toContainEqual({ kind: 'send_unknown', fields: { reminderId: r.id, reason: 'timeout' } })
    await insertReminder(o, 'dispatching', { dispatchedAt: new Date(Date.now() - 3 * MIN) })
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect(alerts()).toContainEqual({ kind: 'send_unknown', fields: { count: 1, reason: 'lease_expired' } })
  })

  it('a refused send (too late) → gate_failed', async () => {
    const o = await readyOwner('al-gate')
    const r = await insertReminder(o, 'scheduled', { remindAtMs: Date.now() - 61 * MIN })
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect(alerts()).toEqual([{ kind: 'gate_failed', fields: { reminderId: r.id, reason: 'too_late' } }])
  })

  it('a send the gate hands back (a race: monitor stale, pause, kill switch) → delivery_deferred', async () => {
    const o = await readyOwner('al-deferred')
    const r = await insertReminder(o, 'scheduled')
    gateOverride.result = { result: 'deferred', reason: 'monitor_stale' }
    try {
      const send = vi.fn()
      await tick(send)
      expect(send).not.toHaveBeenCalled()
      expect(alerts()).toEqual([{ kind: 'delivery_deferred', fields: { reminderId: r.id, reason: 'monitor_stale' } }])
    } finally {
      gateOverride.result = null
    }
  })

  it('an account-scope rejection pauses delivery before anything is claimed → enabled_blocked: account_paused', async () => {
    const o = await readyOwner('al-defer')
    const r = await insertReminder(o, 'scheduled')
    const send = vi.fn(async () => ({ kind: 'sent', wamid: 'wamid.x' }) as PlatformTextOutcome)
    await db(T).insert({
      agencyId: o.agencyId, userId: o.userId, recipientId: o.recipientId, text: 'x', textLength: 1, remindAt: new Date(Date.now() - MIN),
      createdAt: new Date(Date.now() - 2 * MIN), anchorMessageTs: Math.floor(Date.now() / 1000), sourceWamid: `wamid.al.paused.${Date.now()}`,
      status: 'failed', failureReason: 'account_rejected', errorScope: 'account', finalizedAt: new Date(), dispatchedAt: new Date(),
    })
    const s = await tick(send)
    expect(s.mode).toBe('blocked')
    expect(send).not.toHaveBeenCalled()
    expect(alerts()).toEqual([{ kind: 'enabled_blocked', fields: { blockedBy: ['account_paused'] } }])
    expect((await db(T).where({ id: r.id }).first('status')).status).toBe('scheduled')
  })
})

describe('switched on but unable to run is never silent', () => {
  it('database switch on, a control missing → enabled_blocked naming it', async () => {
    await enableDelivery({ agencyDailyCap: null })
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect(alerts()).toEqual([{ kind: 'enabled_blocked', fields: { blockedBy: ['agencyDailyCap'] } }])
  })

  it('database switch on, environment switch off → enabled_blocked: env_switch_off', async () => {
    delete process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect(alerts()).toEqual([{ kind: 'enabled_blocked', fields: { blockedBy: ['env_switch_off'] } }])
  })

  it('the production state today (both switches off, controls unset) raises NO alert', async () => {
    delete process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED
    await resetControls()
    const o = await readyOwner('al-quiet')
    await insertReminder(o, 'scheduled')
    const send = vi.fn()
    expect((await tick(send)).mode).toBe('dry_run')
    expect(send).not.toHaveBeenCalled()
    expect(alerts()).toEqual([])
  })

  it('a deliberately disabled database switch (kill switch tripped) is not an alert by itself', async () => {
    await enableDelivery({ trippedAt: new Date(), trippedReason: 'operator' })
    await tick(sends({ kind: 'sent', wamid: 'wamid.never' }))
    expect(alerts()).toEqual([])
  })
})
