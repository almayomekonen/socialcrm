/**
 * Natural-language reminder times: "תזכיר לי בעוד 5 דקות" and the way people
 * actually say it. Pure, with a fixed clock: every expected time below is
 * computed from the anchor (Meta's timestamp of the owner's message), never
 * from the machine running the test.
 *
 * Default anchor: Tuesday 10.11.2026, 14:20:00 in Jerusalem (UTC+2), processed 3 s later.
 * The full WhatsApp path (draft, card, approval, stored row, delivery) is in
 * __tests__/waAssistant/remindersRelativeTime.db.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readReminderWhen, type ReminderAnchor } from '@/lib/reminders/when'
import { readOffsets, stripOffsets } from '@/lib/reminders/offset'
import { mergeWhen, reminderText } from '@/lib/reminders/request'

const MIN = 60_000
const ANCHOR = Date.parse('2026-11-10T12:20:00Z') // 14:20 Jerusalem
const meta = (ms: number): ReminderAnchor => ({ messageTimestampSec: ms / 1000, source: 'meta' })
const read = (text: string, anchorMs = ANCHOR) => readReminderWhen(text, meta(anchorMs), anchorMs + 3_000)
const at = (text: string, anchorMs = ANCHOR) => {
  const r = read(text, anchorMs)
  return r.ok === true ? `${r.date} ${r.time}` : `ask:${r.ask}`
}

describe('the requirement examples, at 14:20', () => {
  it.each([
    ['תזכיר לי בעוד 5 דקות להתקשר לדני', 5, '14:25'],
    ['תזכיר לי בעוד 10 דקות להתקשר לדני', 10, '14:30'],
    ['תזכיר לי בעוד שעה להתקשר לדני', 60, '15:20'],
    ['תזכיר לי בעוד שעתיים להתקשר לדני', 120, '16:20'],
    ['תזכיר לי בעוד חצי שעה להתקשר לדני', 30, '14:50'],
    ['תזכיר לי בעוד רבע שעה להתקשר לדני', 15, '14:35'],
    ['תזכיר לי בעוד 2 דקות להתקשר לדני', 2, '14:22'],
  ])('%s → +%i min = %s, exactly that many real minutes after the message', (text, minutes, time) => {
    expect(read(text)).toMatchObject({ ok: true, basis: 'relative', offsetMinutes: minutes, remindAtMs: ANCHOR + minutes * MIN, date: '2026-11-10', time })
    expect(reminderText(text)).toBe('להתקשר לדני')
  })

  it('"בעוד דקה": refused as too close by the approved one-minute minimum, with a clear answer', () => {
    expect(read('תזכיר לי בעוד דקה')).toEqual({ ok: false, ask: 'too_soon' })
  })

  it('"מחר בבוקר" → tomorrow 09:00, shown on the card for approval', () => {
    expect(read('תזכיר לי מחר בבוקר להתקשר לדני')).toMatchObject({ ok: true, basis: 'absolute', remindAtMs: Date.parse('2026-11-11T07:00:00Z'), date: '2026-11-11', time: '09:00' })
  })

  it('"מחר בשעה 16:45": a valid time, but beyond the 23-hour WhatsApp window, so it is explained, not scheduled', () => {
    expect(read('תזכיר לי מחר בשעה 16:45 להתקשר')).toEqual({ ok: false, ask: 'beyond_horizon' })
    // Earlier in the day it is inside the window and is read exactly.
    const morning = Date.parse('2026-11-10T16:00:00Z') // 18:00
    expect(at('תזכיר לי מחר בשעה 16:45 להתקשר', morning)).toBe('2026-11-11 16:45')
  })
})

describe('spoken Hebrew variations', () => {
  it.each([
    ['עוד 5 דקות תזכיר לי להתקשר לדני', 5],
    ['תזכיר לי עוד שעה להתקשר לדני', 60],
    ['תזכיר לי עוד עשר דקות להתקשר לדני', 10],
    ['תזכיר לי לעוד חצי שעה להתקשר לדני', 30],
    ['תזכירי לי בעוד חמש דקות להתקשר לדני', 5],
    ['תזכיר לי בעוד עשרה דקות להתקשר לדני', 10],
    ['תזכיר לי בעוד חמש עשרה דקות להתקשר לדני', 15],
    ['תזכיר לי בעוד עשרים וחמש דקות להתקשר לדני', 25],
    ['תזכיר לי בעוד ארבעים וחמש דקות להתקשר לדני', 45],
    ['תזכיר לי בעוד דקותיים להתקשר לדני', 2],
    ['תזכיר לי בעוד 5 דק׳ להתקשר לדני', 5],
    ['תזכיר לי בעוד 5 דק להתקשר לדני', 5],
    ['תזכיר לי בעוד כ-10 דקות להתקשר לדני', 10],
    ['תזכיר לי בעוד בערך שעה להתקשר לדני', 60],
    ['תזכיר לי בעוד שעה בערך להתקשר לדני', 60],
    ['תזכיר לי בעוד 5 דקות מעכשיו להתקשר לדני', 5],
    ['תזכיר לי בעוד 1.5 שעות להתקשר לדני', 90],
    ['תזכיר לי בעוד שלוש וחצי שעות להתקשר לדני', 210],
    ['תזכיר לי בעוד שעה וחצי להתקשר לדני', 90],
    ['תזכיר לי בעוד שלושת רבעי שעה להתקשר לדני', 45],
    ['תזכיר לי להתקשר לדני בעוד 10 דקות', 10],
    ['בעוד 10 דקות תזכיר לי להתקשר לדני', 10],
  ])('%s → +%i min, and the text is only the task', (text, minutes) => {
    expect(read(text)).toMatchObject({ ok: true, basis: 'relative', offsetMinutes: minutes, remindAtMs: ANCHOR + minutes * MIN })
    expect(reminderText(text)).toBe('להתקשר לדני')
  })

  it('a bare "עוד" that is not a duration is just a word: no offset, no question', () => {
    expect(readOffsets('תזכיר לי לקנות עוד חלב')).toEqual({ minutes: [], problem: null })
    expect(reminderText('תזכיר לי לקנות עוד חלב בעוד שעה')).toBe('לקנות עוד חלב')
    expect(read('תזכיר לי לקנות עוד חלב בעוד שעה')).toMatchObject({ ok: true, offsetMinutes: 60 })
  })

  it('an offset is cut out of the text exactly where it was read', () => {
    expect(stripOffsets('א בעוד כ-10 דקות בערך ב').replace(/\s+/g, ' ')).toBe('א ב')
    expect(stripOffsets('בעוד 3 ימים', { keepDays: true })).toBe('בעוד 3 ימים')
  })
})

describe('parts of the day without an hour', () => {
  it.each([
    ['תזכיר לי היום בערב להתקשר', '2026-11-10 19:00'],
    ['תזכיר לי הערב להתקשר', '2026-11-10 19:00'],
    ['תזכיר לי הלילה להתקשר', '2026-11-10 21:00'],
    ['תזכיר לי היום אחר הצהריים להתקשר', '2026-11-10 16:00'],
    ['תזכיר לי מחר בבוקר להתקשר', '2026-11-11 09:00'],
    ['תזכיר לי מחר בצהריים להתקשר', '2026-11-11 12:00'],
    ['תזכיר לי מחר בבוקר בשמונה וחצי להתקשר', '2026-11-11 08:30'], // an hour said wins over the default
    ['תזכיר לי הערב בשמונה להתקשר', '2026-11-10 20:00'],
  ])('%s → %s', (text, expected) => {
    expect(at(text)).toBe(expected)
  })

  it('a part of the day that has already passed today is asked about, never moved to tomorrow', () => {
    expect(at('תזכיר לי היום בבוקר להתקשר')).toBe('ask:past')
  })

  it('a bare part of the day is a period answer: it qualifies the hour already said', () => {
    expect(mergeWhen('תזכיר לי בשש להתקשר', 'בערב', '2026-11-10')).toBe('תזכיר לי בשש להתקשר בערב')
    expect(at(mergeWhen('תזכיר לי בשש להתקשר', 'בערב', '2026-11-10'))).toBe('2026-11-10 18:00')
    expect(at(mergeWhen('תזכיר לי היום בבוקר להתקשר', 'בערב', '2026-11-10'))).toBe('2026-11-10 19:00')
  })

  it('an answer "עוד רבע שעה" to "מתי להזכיר לך?" completes the request', () => {
    const merged = mergeWhen('תזכיר לי להתקשר לדני', 'עוד רבע שעה', '2026-11-10')
    expect(read(merged)).toMatchObject({ ok: true, offsetMinutes: 15, time: '14:35' })
  })
})

describe('midnight and date boundaries', () => {
  const lateNight = Date.parse('2026-11-10T21:50:00Z') // 23:50 Jerusalem
  it.each([
    ['תזכיר לי בעוד 20 דקות להתקשר', 20, '2026-11-11', '00:10'],
    ['תזכיר לי בעוד שעה להתקשר', 60, '2026-11-11', '00:50'],
    ['תזכיר לי בעוד 9 דקות להתקשר', 9, '2026-11-10', '23:59'],
    ['תזכיר לי בעוד 10 דקות להתקשר', 10, '2026-11-11', '00:00'],
  ])('at 23:50, %s → %s %s', (text, minutes, date, time) => {
    expect(read(text, lateNight)).toMatchObject({ ok: true, remindAtMs: lateNight + minutes * MIN, date, time })
  })

  it('at 23:50, "מחר בבוקר" is the next calendar day, 09:00', () => {
    expect(at('תזכיר לי מחר בבוקר להתקשר', lateNight)).toBe('2026-11-11 09:00')
  })

  it('at 00:10, "מחר בבוקר" is the following day (the business day has turned)', () => {
    const afterMidnight = Date.parse('2026-11-10T22:10:00Z') // 00:10 on 11.11
    expect(at('תזכיר לי מחר בבוקר להתקשר', afterMidnight)).toBe('ask:beyond_horizon')
    expect(at('תזכיר לי היום בבוקר להתקשר', afterMidnight)).toBe('2026-11-11 09:00')
  })

  it('at the end of a month, a relative time rolls into the next month', () => {
    const endOfMonth = Date.parse('2026-11-30T21:45:00Z') // 23:45 on 30.11
    expect(read('תזכיר לי בעוד חצי שעה להתקשר', endOfMonth)).toMatchObject({ ok: true, date: '2026-12-01', time: '00:15' })
  })
})

describe('Israel daylight-saving transitions', () => {
  it('fall back (25.10.2026, 02:00 → 01:00): "בעוד שעה" at 01:40 is one real hour later, shown as 01:40 again', () => {
    const a = Date.parse('2026-10-24T22:40:00Z') // 01:40 IDT
    expect(read('תזכיר לי בעוד שעה', a)).toMatchObject({ ok: true, remindAtMs: a + 60 * MIN, date: '2026-10-25', time: '01:40' })
  })

  it('fall back: "בעוד 30 דקות" at 01:50 is 30 real minutes later (01:20 on the second pass)', () => {
    const a = Date.parse('2026-10-24T22:50:00Z') // 01:50 IDT
    expect(read('תזכיר לי בעוד 30 דקות', a)).toMatchObject({ ok: true, remindAtMs: a + 30 * MIN, time: '01:20' })
  })

  it('spring forward (26.3.2027, 02:00 → 03:00): "בעוד 30 דקות" at 01:45 is 02:15 that does not exist → 03:15, 30 real minutes later', () => {
    const a = Date.parse('2027-03-25T23:45:00Z') // 01:45 IST
    expect(read('תזכיר לי בעוד 30 דקות', a)).toMatchObject({ ok: true, remindAtMs: a + 30 * MIN, date: '2027-03-26', time: '03:15' })
  })

  it('"מחר בבוקר" across the fall-back night is 09:00 local, which is 07:00 UTC (not 06:00)', () => {
    const a = Date.parse('2026-10-24T17:00:00Z') // 20:00 IDT on 24.10
    expect(read('תזכיר לי מחר בבוקר', a)).toMatchObject({ ok: true, remindAtMs: Date.parse('2026-10-25T07:00:00Z'), time: '09:00' })
  })

  it('"מחר בבוקר" across the spring-forward night is 09:00 local, which is 06:00 UTC', () => {
    const a = Date.parse('2027-03-25T18:00:00Z') // 20:00 IST on 25.3
    expect(read('תזכיר לי מחר בבוקר', a)).toMatchObject({ ok: true, remindAtMs: Date.parse('2027-03-26T06:00:00Z'), time: '09:00' })
  })
})

describe('the timezone is the business timezone, never the server process\'s', () => {
  const original = process.env.TZ
  afterEach(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  it.each(['UTC', 'America/New_York', 'Asia/Tokyo', 'Not/A_Zone'])('with the process in %s, local time is still read as Asia/Jerusalem', (tz) => {
    process.env.TZ = tz
    expect(read('תזכיר לי בעוד 10 דקות להתקשר')).toMatchObject({ ok: true, remindAtMs: ANCHOR + 10 * MIN, time: '14:30' })
    expect(read('תזכיר לי מחר בבוקר')).toMatchObject({ ok: true, remindAtMs: Date.parse('2026-11-11T07:00:00Z'), time: '09:00' })
    expect(read('תזכיר לי היום ב-16:45')).toMatchObject({ ok: true, remindAtMs: Date.parse('2026-11-10T14:45:00Z'), time: '16:45' })
  })

  it('a local time is never read as UTC: "היום ב-16:45" is 14:45Z in winter and 13:45Z in summer', () => {
    expect(read('תזכיר לי היום ב-16:45')).toMatchObject({ remindAtMs: Date.parse('2026-11-10T14:45:00Z') })
    const summer = Date.parse('2026-07-01T09:00:00Z') // 12:00 IDT
    expect(read('תזכיר לי היום ב-16:45', summer)).toMatchObject({ remindAtMs: Date.parse('2026-07-01T13:45:00Z') })
  })
})

describe('genuinely unclear requests get ONE question', () => {
  it.each([
    ['תזכיר לי בעוד כמה דקות להתקשר', 'ambiguous_offset'],
    ['תזכיר לי בעוד קצת להתקשר', 'ambiguous_offset'],
    ['תזכיר לי בעוד 2.3 דקות להתקשר', 'ambiguous_offset'],
    ['תזכיר לי בעוד שעה ובעוד שעתיים', 'ambiguous_offset'],
    ['תזכיר לי מחר בשלוש להתקשר', 'ambiguous_time'],
    ['תזכיר לי מחר בבוקר או בערב להתקשר', 'ambiguous_time'],
    ['תזכיר לי בעוד שעה ב-10 להתקשר', 'conflicting'],
    ['תזכיר לי להתקשר לדני', 'ask_when'],
    ['תזכיר לי מחר להתקשר לדני', 'ask_time'],
  ])('%s → %s', (text, ask) => {
    expect(read(text)).toMatchObject({ ok: false, ask })
  })

  it('a time is never taken from anything but the anchor: an unverified message timestamp schedules nothing', () => {
    expect(readReminderWhen('בעוד 5 דקות', { messageTimestampSec: ANCHOR / 1000, source: 'server' }, ANCHOR)).toEqual({ ok: false, ask: 'unverified_anchor' })
  })
})
