import { afterEach, describe, expect, it } from 'vitest'
import {
  ALWAYS_EXCLUDED_AGENCY_IDS,
  canUseOwnerWhatsappReminders,
  hasOwnerWhatsappReminderAudience,
  isOwnerWhatsappReminderAgency,
  ownerWhatsappReminderAudience,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { scopeBindings } from '@/db/ownerWhatsappReminders/candidates'

/** The audience model: `all` only from its own variable, 158 never, unset/invalid = today's explicit list. */
const KEYS = ['OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_WA_ME_NUMBER'] as const
afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('ownerWhatsappReminderAudience', () => {
  it('unset: the explicit list, empty by default (absence blocks)', () => {
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [], excludedIds: [158] })
    expect(hasOwnerWhatsappReminderAudience()).toBe(false)
  })

  it.each(['ALL', ' all ', 'true', '*', '1', 'everyone', ''])('audience %j that is not exactly `all` keeps the list', (v) => {
    process.env.OWNER_WA_REMINDERS_AUDIENCE = v
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103'
    const a = ownerWhatsappReminderAudience()
    if (v.trim() === 'all') expect(a.mode).toBe('all')
    else expect(a).toEqual({ mode: 'list', agencyIds: [103], excludedIds: [158] })
  })

  it('OWNER_WA_REMINDERS_AGENCY_IDS=all still opens nothing', () => {
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = 'all'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [], excludedIds: [158] })
    expect(isOwnerWhatsappReminderAgency(103)).toBe(false)
  })

  it('`all`: every agency except the excluded ones; 158 always excluded', () => {
    process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
    process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = '200, x, 201'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'all', excludedIds: [158, 200, 201] })
    expect(isOwnerWhatsappReminderAgency(103)).toBe(true)
    expect(isOwnerWhatsappReminderAgency(999)).toBe(true)
    for (const id of [158, 200, 201]) expect(isOwnerWhatsappReminderAgency(id)).toBe(false)
    for (const id of [0, -1, 1.5, null, undefined]) expect(isOwnerWhatsappReminderAgency(id as number)).toBe(false)
  })

  it('158 is excluded even when explicitly allowlisted, and cannot be un-excluded', () => {
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103,158'
    process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = ''
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [103], excludedIds: [158] })
    expect(isOwnerWhatsappReminderAgency(158)).toBe(false)
    expect(ALWAYS_EXCLUDED_AGENCY_IDS).toContain(158)
  })

  it('the settings gate also needs the platform number and wa.me number', () => {
    process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
    expect(canUseOwnerWhatsappReminders(103)).toBe(false)
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
    process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
    expect(canUseOwnerWhatsappReminders(103)).toBe(true)
    expect(canUseOwnerWhatsappReminders(158)).toBe(false)
  })
})

describe('scopeBindings (the SQL side)', () => {
  it('an id list: list mode, 158 always in the exclusions', () => {
    expect(scopeBindings([103, 7])).toEqual({ allAgencies: false, agencyIds: '{103,7}', excludedAgencyIds: '{158}' })
  })
  it('the `all` audience', () => {
    expect(scopeBindings({ mode: 'all', excludedIds: [158, 200] })).toEqual({ allAgencies: true, agencyIds: '{}', excludedAgencyIds: '{158,200}' })
  })
})
