/**
 * The personal-reminder time reader (Reminder Engine Phase 2). Pure: no DB, no model.
 *
 * Default anchor: Saturday 7.11.2026, 14:30:00 in Jerusalem (UTC+2), the Meta
 * timestamp of the owner's message. Processed 5 s later.
 */
import { describe, expect, it } from 'vitest'
import { checkReminderWindow, readReminderWhen, type ReminderAnchor } from '@/lib/reminders/when'
import { readOffsets } from '@/lib/reminders/offset'
import { readClock } from '@/lib/reminders/clock'

const ANCHOR_MS = Date.parse('2026-11-07T12:30:00Z')
const meta = (ms = ANCHOR_MS): ReminderAnchor => ({ messageTimestampSec: ms / 1000, source: 'meta' })
const read = (text: string, nowMs = ANCHOR_MS + 5_000, anchor = meta()) => readReminderWhen(text, anchor, nowMs)
const at = (text: string, nowMs?: number, anchor?: ReminderAnchor) => {
  const r = read(text, nowMs, anchor)
  return 'ask' in r ? `ask:${r.ask}` : `${r.date} ${r.time}`
}

describe('the acceptance phrases', () => {
  it('"בעוד 5 דקות תזכיר לי להתקשר לאבי": the Meta time + 5 minutes', () => {
    expect(read('בעוד 5 דקות תזכיר לי להתקשר לאבי')).toEqual({
      ok: true,
      remindAtMs: ANCHOR_MS + 5 * 60_000,
      basis: 'relative',
      offsetMinutes: 5,
      date: '2026-11-07',
      time: '14:35',
    })
  })

  it.each([
    ['בעוד 10 דקות תזכיר לי לחזור ללקוח', '2026-11-07 14:40'],
    ['מחר בתשע תזכיר לי להתקשר לאבי', '2026-11-08 09:00'],
    ['תזכיר לי בעוד שעה לבדוק את ההצעה', '2026-11-07 15:30'],
  ])('%s → %s', (text, expected) => {
    expect(at(text)).toBe(expected)
  })

  it('"מחר בתשע" said at 08:00 is more than 23 hours ahead: not scheduled', () => {
    const morning = Date.parse('2026-11-07T06:00:00Z')
    expect(at('מחר בתשע תזכיר לי להתקשר לאבי', morning, meta(morning))).toBe('ask:beyond_horizon')
  })
})

describe('relative minutes and hours', () => {
  it.each([
    ['בעוד 2 דקות', 2],
    ['בעוד חמש דקות', 5],
    ['בעוד עשר דקות', 10],
    ['בעוד עשרים דקות', 20],
    ['בעוד 45 דקות', 45],
    ['בעוד רבע שעה', 15],
    ['בעוד חצי שעה', 30],
    ['בעוד שלושת רבעי שעה', 45],
    ['בעוד שעה', 60],
    ['בעוד שעה ורבע', 75],
    ['בעוד שעה ועשר דקות', 70],
    ['בעוד שעה וחצי', 90],
    ['בעוד שעתיים', 120],
    ['בעוד שעתיים וחצי', 150],
    ['בעוד 3 שעות', 180],
    ['בעוד שלוש שעות', 180],
    ['ובעוד 7 שעות', 420],
    ['תזכיר לי שבעוד שעה אני צריך להתקשר', 60],
  ])('%s → +%i minutes', (text, minutes) => {
    const r = read(text)
    expect(r).toMatchObject({ ok: true, basis: 'relative', offsetMinutes: minutes, remindAtMs: ANCHOR_MS + minutes * 60_000 })
  })

  it.each([
    ['בעוד קצת', 'ambiguous_offset'],
    ['בעוד 0 דקות', 'ambiguous_offset'],
    ['בעוד דקות', 'ambiguous_offset'],
    ['בעוד שעות', 'ambiguous_offset'],
    ['בעוד שעה ובעוד שעתיים', 'ambiguous_offset'],
    ['בעוד 25 שעות', 'beyond_horizon'],
    ['בעוד דקה', 'too_soon'],
    ['מחר בעוד שעה', 'conflicting'],
    ['בעוד שעה ב-10', 'conflicting'],
    ['בעוד 3 ימים ב-10', 'beyond_horizon'],
    ['בעוד יומיים', 'ask_time'],
  ])('%s → %s', (text, ask) => {
    expect(read(text)).toMatchObject({ ok: false, ask })
  })
})

describe('clock times, including Hebrew hour words', () => {
  it.each([
    ['מחר ב-9', '2026-11-08 09:00'],
    ['מחר בשעה 9', '2026-11-08 09:00'],
    ['מחר בשמונה', '2026-11-08 08:00'],
    ['מחר בשמונה וחצי', '2026-11-08 08:30'],
    ['מחר ב-8 ורבע', '2026-11-08 08:15'],
    ['מחר בעשר', '2026-11-08 10:00'],
    ['מחר באחת עשרה', '2026-11-08 11:00'],
    ['מחר בחמש בבוקר', '2026-11-08 05:00'],
    ['היום בתשע בערב', '2026-11-07 21:00'],
    ['היום ב-9 וחצי בערב', '2026-11-07 21:30'],
    ['היום בחמש אחה"צ', '2026-11-07 17:00'],
    ['היום בשתיים בצהריים', 'ask:past'],
    ['היום באחת עשרה בלילה', '2026-11-07 23:00'],
    ['ב-14:45', '2026-11-07 14:45'],
    ['ב-10:30 בערב', '2026-11-07 22:30'],
  ])('%s → %s', (text, expected) => {
    expect(at(text)).toBe(expected)
  })

  it.each([
    ['מחר בשלוש', 3],
    ['מחר ב-5', 5],
    ['מחר בשבע', 7],
  ])('a bare hour 1–7 with no period is ambiguous: %s', (text, hour) => {
    expect(read(text)).toEqual({ ok: false, ask: 'ambiguous_time', hour })
  })

  it.each([
    ['מחר בתשע פחות רבע', 'ambiguous_time'],
    ['מחר ב-10 או ב-11', 'ambiguous_time'],
    ['מחר בשמונה בצהריים', 'ambiguous_time'],
    ['מחר ב-9 בבוקר בערב', 'ambiguous_time'],
  ])('%s → %s', (text, ask) => {
    expect(read(text)).toMatchObject({ ok: false, ask })
  })

  it('"היום בתשע" after 09:00 asks; it is never read as 21:00', () => {
    expect(at('היום בתשע')).toBe('ask:past')
    expect(at('בתשע')).toBe('ask:past')
  })

  it('"בשני" (Monday) is not an hour', () => {
    expect(readClock('בשני ב-10')).toEqual({ times: ['10:00'], problem: null, hour: 10 })
  })
})

describe('what is missing is asked, never assumed', () => {
  it.each([
    ['תזכיר לי להתקשר לאבי', 'ask_when'],
    ['תזכיר לי מחר לשלוח הצעה', 'ask_time'],
    ['מחר או ביום שלישי ב-10', 'ambiguous_date'],
    ['ב-01.10 ב-10', 'past'],
  ])('%s → %s', (text, ask) => {
    expect(read(text)).toMatchObject({ ok: false, ask })
  })
})

describe('the anchor is the verified Meta timestamp', () => {
  it('a server-time fallback, an unknown source or a missing timestamp schedules nothing', () => {
    expect(read('בעוד 5 דקות', undefined, { messageTimestampSec: ANCHOR_MS / 1000, source: 'server' })).toEqual({ ok: false, ask: 'unverified_anchor' })
    expect(read('בעוד 5 דקות', undefined, { messageTimestampSec: ANCHOR_MS / 1000, source: null })).toEqual({ ok: false, ask: 'unverified_anchor' })
    expect(read('בעוד 5 דקות', undefined, { messageTimestampSec: null, source: 'meta' })).toEqual({ ok: false, ask: 'unverified_anchor' })
    expect(read('בעוד 5 דקות', undefined, { messageTimestampSec: 1.5, source: 'meta' })).toEqual({ ok: false, ask: 'unverified_anchor' })
  })

  it('relative time comes from the Meta timestamp, not from when the worker runs', () => {
    expect(read('בעוד 5 דקות', ANCHOR_MS + 3 * 60_000)).toMatchObject({ ok: true, time: '14:35' })
    expect(read('בעוד 5 דקות', ANCHOR_MS + 4 * 60_000 + 30_000)).toMatchObject({ ok: false, ask: 'too_soon' })
    expect(read('בעוד 5 דקות', ANCHOR_MS + 6 * 60_000)).toMatchObject({ ok: false, ask: 'past' })
  })

  it('"today" and "tomorrow" are business days at the anchor', () => {
    const lateNight = Date.parse('2026-11-07T21:50:00Z') // 23:50 in Jerusalem
    expect(at('מחר בתשע', lateNight + 30 * 60_000, meta(lateNight))).toBe('2026-11-08 09:00') // processed after midnight
  })
})

describe('the scheduling window', () => {
  const now = ANCHOR_MS
  it.each([
    [61_000, null],
    [60_000, 'too_soon'],
    [59_000, 'too_soon'],
    [0, 'past'],
    [-1_000, 'past'],
  ])('remaining %i ms → %s', (remaining, expected) => {
    expect(checkReminderWindow(now + remaining, ANCHOR_MS, now)).toBe(expected)
  })

  it('the 23-hour horizon is measured from the anchor; exactly 23 h is allowed', () => {
    expect(checkReminderWindow(ANCHOR_MS + 23 * 3_600_000, ANCHOR_MS, now)).toBeNull()
    expect(checkReminderWindow(ANCHOR_MS + 23 * 3_600_000 + 1, ANCHOR_MS, now)).toBe('beyond_horizon')
  })

  it('effective now is the later of server time and the anchor', () => {
    expect(checkReminderWindow(ANCHOR_MS + 90_000, ANCHOR_MS, ANCHOR_MS - 600_000)).toBeNull() // server clock behind: anchor wins
    expect(checkReminderWindow(ANCHOR_MS + 90_000, ANCHOR_MS, ANCHOR_MS + 40_000)).toBe('too_soon') // server later: server wins
  })
})

describe('clock changes', () => {
  it('a relative offset is absolute time: "בעוד שעה" from 01:30 on spring-forward day shows 03:30', () => {
    const a = Date.parse('2027-03-25T23:30:00Z') // 2027-03-26 01:30 (+2)
    expect(read('בעוד שעה', a, meta(a))).toMatchObject({ ok: true, remindAtMs: a + 3_600_000, time: '03:30', date: '2027-03-26' })
  })

  it('a wall-clock time that does not exist moves forward: "מחר ב-02:30" on spring-forward day is 03:30', () => {
    const a = Date.parse('2027-03-25T18:00:00Z') // 20:00 the evening before
    expect(read('מחר ב-02:30', a, meta(a))).toMatchObject({ ok: true, remindAtMs: Date.parse('2027-03-26T00:30:00Z'), time: '03:30' })
  })

  it('a wall-clock time that occurs twice is the first: "מחר ב-01:30" on fall-back day', () => {
    const a = Date.parse('2026-10-24T17:00:00Z') // 20:00 (+3) the evening before
    expect(read('מחר ב-01:30', a, meta(a))).toMatchObject({ ok: true, remindAtMs: Date.parse('2026-10-24T22:30:00Z'), time: '01:30' })
  })
})

describe('the readers on their own', () => {
  it('offsets: day and week offsets are left to the date reader', () => {
    expect(readOffsets('בעוד שבוע')).toEqual({ minutes: [], problem: null })
    expect(readOffsets('בעוד 3 ימים')).toEqual({ minutes: [], problem: null })
  })

  it('clock: digits inside dates are not hours', () => {
    expect(readClock('ב-27.10 ב-12:15').times).toEqual(['12:15'])
    expect(readClock('ב-3/11/2026').times).toEqual([])
  })
})
