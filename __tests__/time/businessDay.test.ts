import { describe, it, expect } from 'vitest'
import { BUSINESS_TZ, startOfBusinessDay, isBeforeBusinessDay, classifyUrgency } from '@/lib/time/businessDay'

const at = (s: string) => new Date(s).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

describe('businessDay helper', () => {
  it('BUSINESS_TZ is Asia/Jerusalem', () => {
    expect(BUSINESS_TZ).toBe('Asia/Jerusalem')
  })

  describe('startOfBusinessDay — DST-aware, no fixed UTC offset', () => {
    // Israel is UTC+2 (IST, winter) and UTC+3 (IDT, summer). Midnight Israel is
    // therefore 22:00Z (winter) or 21:00Z (summer) of the previous UTC day.
    it('summer IDT (+3): midnight = 21:00Z prev day', () => {
      expect(iso(startOfBusinessDay(at('2026-07-10T09:00:00Z')))).toBe('2026-07-09T21:00:00.000Z')
    })

    it('winter IST (+2): midnight = 22:00Z prev day', () => {
      expect(iso(startOfBusinessDay(at('2026-01-15T09:00:00Z')))).toBe('2026-01-14T22:00:00.000Z')
    })

    it('spring-forward day (2026-03-27, clocks +2→+3 at 02:00): midnight uses +2', () => {
      // Midnight of Mar 27 is BEFORE the 02:00 transition, so it is at +2.
      expect(iso(startOfBusinessDay(at('2026-03-27T10:00:00Z')))).toBe('2026-03-26T22:00:00.000Z')
    })

    it('fall-back day (2026-10-25, clocks +3→+2 at 02:00): midnight uses +3', () => {
      // Midnight of Oct 25 is BEFORE the 02:00 transition, so it is still at +3.
      expect(iso(startOfBusinessDay(at('2026-10-25T10:00:00Z')))).toBe('2026-10-24T21:00:00.000Z')
    })

    it('rolls over at Israel midnight, not UTC midnight (summer)', () => {
      // 00:30 Jul 10 Israel (21:30Z Jul 9) → business day starts 21:00Z Jul 9.
      expect(iso(startOfBusinessDay(at('2026-07-09T21:30:00Z')))).toBe('2026-07-09T21:00:00.000Z')
      // 23:30 Jul 9 Israel (20:30Z Jul 9) → still the Jul 9 business day.
      expect(iso(startOfBusinessDay(at('2026-07-09T20:30:00Z')))).toBe('2026-07-08T21:00:00.000Z')
    })

    it('is idempotent: start-of-day of a start-of-day is itself', () => {
      const s = startOfBusinessDay(at('2026-07-10T09:00:00Z'))
      expect(startOfBusinessDay(s)).toBe(s)
    })
  })

  describe('classifyUrgency — the exact bug scenario, now consistent', () => {
    const now = at('2026-07-10T09:00:00Z') // 12:00 Israel

    it('follow-up in the UTC↔Israel midnight gap is "today", not "overdue"', () => {
      // 22:00Z Jul 9 = 01:00 Jul 10 Israel → same business day as `now`.
      // (Previously: UTC server said "באיחור", Jerusalem client said "להיום" → #418.)
      expect(classifyUrgency({ nextFollowUpAt: '2026-07-09T22:00:00Z', status: 'contacted' }, now)).toEqual({
        label: 'להיום',
        tone: 'text-warning-text',
      })
    })

    it('follow-up on an earlier business day is overdue', () => {
      expect(classifyUrgency({ nextFollowUpAt: '2026-07-08T09:00:00Z', status: 'contacted' }, now)).toEqual({
        label: 'באיחור',
        tone: 'text-error-text',
      })
    })

    it('no follow-up + new status → new', () => {
      expect(classifyUrgency({ nextFollowUpAt: null, status: 'new' }, now)).toEqual({
        label: 'חדש',
        tone: 'text-primary-text',
      })
    })

    it('no follow-up + other status → waiting', () => {
      expect(classifyUrgency({ nextFollowUpAt: null, status: 'contacted' }, now)).toEqual({
        label: 'ממתין',
        tone: 'text-gray-400',
      })
    })
  })

  describe('isBeforeBusinessDay', () => {
    const now = at('2026-07-10T09:00:00Z')

    it('an earlier business day is before today', () => {
      expect(isBeforeBusinessDay(at('2026-07-09T06:00:00Z'), now)).toBe(true) // 09:00 Jul 9 Israel
    })

    it('a time later today (gap case) is NOT before today', () => {
      expect(isBeforeBusinessDay(at('2026-07-09T22:00:00Z'), now)).toBe(false) // 01:00 Jul 10 Israel
    })
  })
})
