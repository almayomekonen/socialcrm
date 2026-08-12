// Pure contract tests for mobile lead filters, wa.me links, and follow-up badges.
//
// No DOM, no database. `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect } from 'vitest'
import {
  parseLeadFilters,
  serializeLeadFilters,
  leadsHref,
  hasActiveFilters,
  LEAD_STATUSES,
  EMPTY_FILTERS,
} from '@/modules/leads/filters'
import { waMeHref, waPhoneDigits } from '@/modules/leads/whatsapp'
import { followUpBadge } from '@/modules/leads/mobile/followUpBadge'

describe('lead filters', () => {
  test('the vocabulary is exactly the five product statuses', () => {
    expect(LEAD_STATUSES).toEqual(['new', 'contacted', 'interested', 'closed', 'lost'])
  })

  test('parseLeadFilters drops unknown statuses and caps q', () => {
    expect(parseLeadFilters({ q: '  דני  ', status: 'new,pipeline,lost,new' })).toEqual({
      q: 'דני',
      status: ['new', 'lost'],
    })
    expect(parseLeadFilters({ q: 'x'.repeat(150) }).q).toHaveLength(100)
    expect(parseLeadFilters(null)).toEqual(EMPTY_FILTERS)
  })

  test('serialize omits empties so "no filters" is a single canonical URL', () => {
    expect(serializeLeadFilters(EMPTY_FILTERS)).toBe('')
    expect(leadsHref({ q: 'א', status: ['new'] })).toBe(
      `/leads?${new URLSearchParams({ q: 'א', status: 'new' }).toString()}`,
    )
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ q: 'א', status: [] })).toBe(true)
  })
})

describe('wa.me', () => {
  test('builds a digits-only wa.me URL and never invents a message', () => {
    expect(waMeHref('054-123-4567')).toMatch(/^https:\/\/wa\.me\/972/)
    expect(waMeHref('054-123-4567')?.includes('text=')).toBe(false)
    expect(waMeHref(null)).toBeNull()
    expect(waPhoneDigits('12')).toBeNull()
  })

  test('optional text is encoded, never interpolated raw', () => {
    const href = waMeHref('0541234567', 'שלום & עוד')
    expect(href).toContain('text=')
    expect(href).not.toContain('שלום & עוד')
  })
})

describe('followUpBadge', () => {
  const dayStart = Date.parse('2026-08-13T00:00:00+03:00')
  const now = Date.parse('2026-08-13T12:00:00+03:00')

  test('overdue / today / none', () => {
    expect(followUpBadge('2026-08-12T10:00:00+03:00', now, dayStart)?.label).toBe('מעקב באיחור')
    expect(followUpBadge('2026-08-13T18:00:00+03:00', now, dayStart)?.label).toBe('מעקב להיום')
    expect(followUpBadge('2026-08-20T10:00:00+03:00', now, dayStart)).toBeNull()
    expect(followUpBadge(null, now, dayStart)).toBeNull()
  })
})
