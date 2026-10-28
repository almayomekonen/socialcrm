import { describe, expect, test } from 'vitest'
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatRelative, formatTime } from '@/lib/i18n/format'
import { BUSINESS_TZ } from '@/lib/today/constants'

// 2026-03-26 22:30 UTC is already Friday 27 March 01:30 in Jerusalem (IDT starts
// 27 Mar 2026). A formatter that used UTC would report the 26th.
const LATE_EVENING_UTC = '2026-03-26T22:30:00Z'

describe('dates use the zone they are given, never the server zone', () => {
  test('business day boundary follows BUSINESS_TZ', () => {
    expect(formatDate('en', LATE_EVENING_UTC, BUSINESS_TZ, 'short')).toBe('3/27/2026')
    expect(formatDate('en', LATE_EVENING_UTC, 'UTC', 'short')).toBe('3/26/2026')
  })

  test('across the DST change the wall-clock time is local', () => {
    expect(formatTime('en', '2026-03-26T10:00:00Z', BUSINESS_TZ)).toBe('12:00 PM')
    expect(formatTime('en', '2026-03-27T10:00:00Z', BUSINESS_TZ)).toBe('01:00 PM')
  })

  test('a meeting formats in its own stored zone', () => {
    expect(formatTime('en', '2026-06-01T12:00:00Z', 'America/New_York')).toBe('08:00 AM')
  })

  test('Hebrew and Arabic month names; Arabic keeps Latin digits', () => {
    expect(formatDate('he', LATE_EVENING_UTC, BUSINESS_TZ)).toContain('במרץ')
    const ar = formatDate('ar', LATE_EVENING_UTC, BUSINESS_TZ)
    expect(ar).toContain('27')
    expect(ar).toContain('مارس')
    expect(ar).not.toMatch(/[٠-٩]/)
    expect(formatDateTime('ar', LATE_EVENING_UTC, BUSINESS_TZ)).not.toMatch(/[٠-٩]/)
  })
})

describe('relative time takes `now` as input (no clock reads)', () => {
  const now = '2026-10-28T12:00:00Z'
  test('per locale', () => {
    expect(formatRelative('en', '2026-10-27T12:00:00Z', now)).toBe('yesterday')
    expect(formatRelative('he', '2026-10-27T12:00:00Z', now)).toBe('אתמול')
    expect(formatRelative('ar', '2026-10-27T12:00:00Z', now)).toBe('أمس')
    expect(formatRelative('en', '2026-10-28T15:00:00Z', now)).toBe('in 3 hours')
    expect(formatRelative('en', now, now)).toBe('this minute')
  })
})

describe('numbers and money', () => {
  test('grouping per locale; Arabic Latin digits', () => {
    expect(formatNumber('en', 1234567)).toBe('1,234,567')
    expect(formatNumber('ar', 1234567)).not.toMatch(/[٠-٩]/)
  })

  test('percent is a ratio', () => {
    expect(formatPercent('en', 0.25)).toBe('25%')
  })

  test('money keeps the currency of the record in every locale', () => {
    expect(formatMoney('en', 1200, 'ILS')).toBe('₪1,200')
    expect(formatMoney('en', 1200.5, 'USD')).toBe('$1,200.5')
    expect(formatMoney('ar', 5, 'USD')).toContain('5')
    expect(formatMoney('ar', 5, 'USD')).toContain('US$')
    expect(formatMoney('ar', 5, 'USD')).not.toMatch(/[٠-٩]/)
    for (const locale of ['he', 'en', 'ar'] as const) expect(formatMoney(locale, 10, 'EUR')).toContain('€')
  })

  test('Hebrew ILS matches the existing formatCurrency output', async () => {
    const { formatCurrency } = await import('@/lib/funcs')
    expect(formatMoney('he', 1234.5, 'ILS')).toBe(formatCurrency(1234.5))
  })
})
