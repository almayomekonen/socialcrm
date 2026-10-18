import { afterEach, describe, expect, it } from 'vitest'
import {
  canUseOwnerWhatsappReminders,
  hasOwnerWhatsappReminderAudience,
  isOwnerWhatsappReminderAgency,
  ownerWhatsappReminderAudience,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { scopeBindings } from '@/db/ownerWhatsappReminders/candidates'

/**
 * The audience model: `all` only from its own variable, exclusions only from
 * OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS (no agency is excluded in code,
 * 158 included), unset/invalid = today's explicit list.
 */
const KEYS = ['OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_WA_ME_NUMBER'] as const
afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('ownerWhatsappReminderAudience', () => {
  it('unset: the explicit list, empty by default (absence blocks), nothing excluded', () => {
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [], excludedIds: [] })
    expect(hasOwnerWhatsappReminderAudience()).toBe(false)
  })

  it.each(['ALL', ' all ', 'true', '*', '1', 'everyone', ''])('audience %j that is not exactly `all` keeps the list', (v) => {
    process.env.OWNER_WA_REMINDERS_AUDIENCE = v
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103'
    const a = ownerWhatsappReminderAudience()
    if (v.trim() === 'all') expect(a.mode).toBe('all')
    else expect(a).toEqual({ mode: 'list', agencyIds: [103], excludedIds: [] })
  })

  it('OWNER_WA_REMINDERS_AGENCY_IDS=all still opens nothing', () => {
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = 'all'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [], excludedIds: [] })
    expect(isOwnerWhatsappReminderAgency(103)).toBe(false)
  })

  it('`all`: every agency, 158 included, except the configured exclusions', () => {
    process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'all', excludedIds: [] })
    for (const id of [103, 158, 999]) expect(isOwnerWhatsappReminderAgency(id)).toBe(true)
    process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = '200, x, 201'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'all', excludedIds: [200, 201] })
    for (const id of [200, 201]) expect(isOwnerWhatsappReminderAgency(id)).toBe(false)
    expect(isOwnerWhatsappReminderAgency(158)).toBe(true)
    for (const id of [0, -1, 1.5, null, undefined]) expect(isOwnerWhatsappReminderAgency(id as number)).toBe(false)
  })

  it('the exclusion variable wins over the explicit list, for any agency (158 too)', () => {
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103,158'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [103, 158], excludedIds: [] })
    expect(isOwnerWhatsappReminderAgency(158)).toBe(true)
    process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = '158'
    expect(ownerWhatsappReminderAudience()).toEqual({ mode: 'list', agencyIds: [103], excludedIds: [158] })
    expect(isOwnerWhatsappReminderAgency(158)).toBe(false)
  })

  it('the settings gate also needs the platform number and wa.me number', () => {
    process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
    expect(canUseOwnerWhatsappReminders(103)).toBe(false)
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
    process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
    expect(canUseOwnerWhatsappReminders(103)).toBe(true)
    expect(canUseOwnerWhatsappReminders(158)).toBe(true)
    process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS = '158'
    expect(canUseOwnerWhatsappReminders(158)).toBe(false)
  })
})

describe('scopeBindings (the SQL side)', () => {
  it('an id list: list mode, no exclusions', () => {
    expect(scopeBindings([103, 7])).toEqual({ allAgencies: false, agencyIds: '{103,7}', excludedAgencyIds: '{}' })
  })
  it('the `all` audience with its configured exclusions', () => {
    expect(scopeBindings({ mode: 'all', excludedIds: [200] })).toEqual({ allAgencies: true, agencyIds: '{}', excludedAgencyIds: '{200}' })
  })
})
