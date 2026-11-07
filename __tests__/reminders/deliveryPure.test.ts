/** Reminder Engine Phase 5: pure delivery helpers (no database). */
import { describe, expect, it } from 'vitest'
import { reminderMessage } from '@/lib/reminders/delivery/message'
import { billingMonth, isValidTimezone } from '@/lib/reminders/delivery/period'
import { parsePlatformStatus } from '@/db/platformWhatsappMessageStatus'

const MIN = 60_000
const at = Date.parse('2026-11-07T08:00:00Z')

describe('reminderMessage', () => {
  it('an action said with ל… reads "הגיע הזמן"', () => {
    expect(reminderMessage('להתקשר לאבי', at, at)).toBe('תזכורת: הגיע הזמן להתקשר לאבי.')
  })
  it('anything else is quoted as is, without a doubled full stop', () => {
    expect(reminderMessage('פגישה עם דנה.', at, at)).toBe('תזכורת: פגישה עם דנה.')
  })
  it('up to 5 minutes late says nothing; later names the original time (Asia/Jerusalem)', () => {
    expect(reminderMessage('להתקשר לאבי', at, at + 5 * MIN)).toBe('תזכורת: הגיע הזמן להתקשר לאבי.')
    expect(reminderMessage('להתקשר לאבי', at, at + 6 * MIN)).toBe('תזכורת: הגיע הזמן להתקשר לאבי. (נקבעה ל-10:00)')
  })
})

describe('billingMonth', () => {
  it('follows the billing timezone, not UTC', () => {
    const lateOct31Utc = Date.parse('2026-10-31T23:30:00Z') // already 1 November in Jerusalem
    expect(billingMonth(lateOct31Utc, 'Asia/Jerusalem').periodStart).toBe('2026-11-01')
    expect(billingMonth(lateOct31Utc, 'America/Los_Angeles').periodStart).toBe('2026-10-01')
  })
  it('bounds are the local midnights, across a DST change', () => {
    const m = billingMonth(Date.parse('2026-10-15T12:00:00Z'), 'Asia/Jerusalem')
    expect(new Date(m.startMs).toISOString()).toBe('2026-09-30T21:00:00.000Z')
    expect(new Date(m.endMs).toISOString()).toBe('2026-10-31T22:00:00.000Z')
  })
  it('rejects unknown or missing timezones', () => {
    expect(isValidTimezone('Asia/Jerusalem')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(isValidTimezone(null)).toBe(false)
  })
})

describe('parsePlatformStatus pricing (R3)', () => {
  it('reads Meta pricing when present, null otherwise', () => {
    const e = parsePlatformStatus({ id: 'wamid.x', status: 'delivered', timestamp: '1762500000', pricing: { pricing_model: 'PMP', type: 'free_customer_service', category: 'service', billable: false } })
    expect(e?.pricing).toEqual({ model: 'PMP', type: 'free_customer_service', category: 'service', billable: false })
    expect(parsePlatformStatus({ id: 'wamid.y', status: 'sent', timestamp: '1762500000' })?.pricing).toBeNull()
  })
})
