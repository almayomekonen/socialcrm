import { describe, expect, it } from 'vitest'
import { hebrewDateLabel, parseHebrewWhen, resolveWhen } from '@/lib/waAssistant/meetings/when'
import { businessInstantMs } from '@/lib/today/time'

/** Deterministic Hebrew date/time reading for WhatsApp meetings, in Asia/Jerusalem. Pure. */

// Monday 19.10.2026, 12:00 in Jerusalem (UTC+3).
const MON = Date.parse('2026-10-19T09:00:00Z')
const p = (t: string, now = MON) => parseHebrewWhen(t, now)

describe('relative dates', () => {
  it.each([
    ['תקבע לי עם Itamar Am מחר ב-10:00', '2026-10-20', '10:00'],
    ['פגישה היום בשעה 16', '2026-10-19', '16:00'],
    ['למחרתיים ב־9', '2026-10-21', '09:00'],
    ['ביום חמישי ב-14:30', '2026-10-22', '14:30'],
    ['יום ראשון הבא ב-11', '2026-10-25', '11:00'],
    ['ב-27.10 ב-12:15', '2026-10-27', '12:15'],
    ['ב-3/11/2026 ב-8', '2026-11-03', '08:00'],
  ])('%s', (text, date, time) => {
    expect(p(text)).toEqual({ date, time, problem: null })
  })

  it('a weekday equal to today needs "הבא"; with it, next week', () => {
    expect(p('ביום שני ב-10').problem).toBe('ambiguous_date')
    expect(p('ביום שני הבא ב-10')).toEqual({ date: '2026-10-26', time: '10:00', problem: null })
  })

  it('a past date and an impossible date are not dates', () => {
    expect(p('ב-01.10 ב-10')).toMatchObject({ date: null, problem: 'past_date' })
    expect(p('ב-31.02 ב-10').date).toBeNull()
  })

  it('two different dates are ambiguous, never picked', () => {
    expect(p('מחר או ביום חמישי ב-10')).toMatchObject({ date: null, problem: 'ambiguous_date' })
  })

  it('missing parts stay missing', () => {
    expect(p('תקבע פגישה עם דניאל')).toEqual({ date: null, time: null, problem: null })
    expect(p('מחר')).toEqual({ date: '2026-10-20', time: null, problem: null })
  })
})

describe('times', () => {
  it('a bare hour 1-7 could be morning or evening: ambiguous', () => {
    expect(p('מחר ב-5')).toMatchObject({ time: null, problem: 'ambiguous_time' })
  })
  it('בבוקר / בערב / אחה"צ decide it', () => {
    expect(p('מחר ב-5 בערב').time).toBe('17:00')
    expect(p('מחר ב-5 אחה"צ').time).toBe('17:00')
    expect(p('מחר ב-7 בבוקר').time).toBe('07:00')
    expect(p('מחר 8:30 בערב').time).toBe('20:30')
  })
  it('two different times are ambiguous', () => {
    expect(p('מחר ב-10 או ב-11')).toMatchObject({ time: null, problem: 'ambiguous_time' })
  })
  it('a date is never read as a time', () => {
    expect(p('ב-27.10')).toEqual({ date: '2026-10-27', time: null, problem: null })
  })
})

describe('clarification across turns', () => {
  it('fills only what the current message lacks', () => {
    expect(resolveWhen('ב-10', ['תקבע לי עם דניאל מחר'], MON)).toEqual({ date: '2026-10-20', time: '10:00', problem: null })
    expect(resolveWhen('ביום חמישי ב-10', ['מחר ב-9'], MON)).toEqual({ date: '2026-10-22', time: '10:00', problem: null })
  })
})

describe('business timezone and DST (Asia/Jerusalem)', () => {
  it('"מחר" across the October switch lands on the right calendar day and offset', () => {
    const sat = Date.parse('2026-10-24T20:00:00Z') // Saturday 23:00 local, still UTC+3
    expect(p('מחר ב-10:00', sat)).toEqual({ date: '2026-10-25', time: '10:00', problem: null })
    expect(new Date(businessInstantMs('2026-10-25', '10:00')).toISOString()).toBe('2026-10-25T08:00:00.000Z') // UTC+2
    expect(new Date(businessInstantMs('2026-10-24', '10:00')).toISOString()).toBe('2026-10-24T07:00:00.000Z') // UTC+3
  })
  it('"מחר" across the March switch', () => {
    const thu = Date.parse('2027-03-25T21:30:00Z') // Thursday 23:30 local, UTC+2
    expect(p('מחר ב-10:00', thu).date).toBe('2027-03-26')
    expect(new Date(businessInstantMs('2027-03-26', '10:00')).toISOString()).toBe('2027-03-26T07:00:00.000Z') // UTC+3
  })
  it('late at night "מחר" is the next business day, not the next UTC day', () => {
    const late = Date.parse('2026-10-19T21:30:00Z') // 00:30 local on Tuesday 20.10
    expect(p('מחר ב-10', late).date).toBe('2026-10-21')
  })
})

it('hebrewDateLabel', () => {
  expect(hebrewDateLabel('2026-10-20')).toBe('יום שלישי, 20.10.2026')
})
