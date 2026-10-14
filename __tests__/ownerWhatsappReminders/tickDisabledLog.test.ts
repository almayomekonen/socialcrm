import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findReminderCandidates: vi.fn(),
  loadActiveRecipients: vi.fn(),
  claimDueDeliveries: vi.fn(),
  finalizeReminders: vi.fn(),
  isSendingPaused: vi.fn(),
  reapStaleSending: vi.fn(),
  scheduleReminder: vi.fn(),
  quietHoursByAgency: vi.fn(),
}))

vi.mock('@/db/ownerWhatsappReminders/candidates', () => ({
  findReminderCandidates: db.findReminderCandidates,
  loadActiveRecipients: db.loadActiveRecipients,
}))
vi.mock('@/db/ownerWhatsappReminders/deliveries', () => ({
  claimDueDeliveries: db.claimDueDeliveries,
  finalizeReminders: db.finalizeReminders,
  isSendingPaused: db.isSendingPaused,
  reapStaleSending: db.reapStaleSending,
}))
vi.mock('@/db/ownerWhatsappReminders/schedule', () => ({ scheduleReminder: db.scheduleReminder }))
vi.mock('@/db/notifications/unanswered', () => ({ quietHoursByAgency: db.quietHoursByAgency }))

import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'

const ENV_KEYS = [
  'PLATFORM_WHATSAPP_PHONE_NUMBER_ID',
  'OWNER_WA_REMINDERS_AGENCY_IDS',
  'OWNER_WA_REMINDERS_SEND_ENABLED',
  'PLATFORM_WHATSAPP_ACCESS_TOKEN',
] as const

const DISABLED_MSG = '[OwnerWaReminder][tick] disabled'
const DISABLED_SUMMARY = { mode: 'disabled', candidates: 0, scheduled: 0, noRecipients: 0, wouldRemind: 0, reaped: 0, paused: false, sends: {} }

function expectNoDbCalls() {
  for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled()
}

describe('owner WhatsApp reminders tick: disabled log line', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    for (const fn of Object.values(db)) fn.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    logSpy.mockRestore()
  })

  it('nothing configured: disabled summary, one disabled line, no DB call', async () => {
    const summary = await tickOwnerWhatsappReminders()
    expect(summary).toEqual(DISABLED_SUMMARY)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(DISABLED_MSG, { platformNumberConfigured: false, allowlistedAgencies: 0 })
    expectNoDbCalls()
  })

  it('platform number set, empty allowlist', async () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
    const summary = await tickOwnerWhatsappReminders()
    expect(summary).toEqual(DISABLED_SUMMARY)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(DISABLED_MSG, { platformNumberConfigured: true, allowlistedAgencies: 0 })
    expectNoDbCalls()
  })

  it('allowlist set, no platform number', async () => {
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103'
    const summary = await tickOwnerWhatsappReminders()
    expect(summary).toEqual(DISABLED_SUMMARY)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(DISABLED_MSG, { platformNumberConfigured: false, allowlistedAgencies: 1 })
    expectNoDbCalls()
  })

  it('the logged object never carries the phone number id or agency ids', async () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
    await tickOwnerWhatsappReminders()
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103'
    delete process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID
    await tickOwnerWhatsappReminders()
    expect(logSpy).toHaveBeenCalledTimes(2)
    for (const call of logSpy.mock.calls) {
      const logged = JSON.stringify(call)
      expect(logged).not.toContain('1000000000001')
      expect(logged).not.toContain('103')
    }
  })

  it('both configured (dry run): the disabled line is not logged', async () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103'
    db.findReminderCandidates.mockResolvedValue([])
    db.loadActiveRecipients.mockResolvedValue(new Map())
    db.quietHoursByAgency.mockResolvedValue(new Map())
    const summary = await tickOwnerWhatsappReminders()
    expect(summary.mode).toBe('dry_run')
    expect(db.findReminderCandidates).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls.some((c) => c[0] === DISABLED_MSG)).toBe(false)
  })
})
