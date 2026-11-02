import { describe, expect, it } from 'vitest'
import { businessInstantMs } from '@/lib/today/time'
import { isClarifyingAnswer, readDraft, settleWhen, withWhen } from '@/lib/waAssistant/tasks/draft'

/**
 * One task / follow-up request read across the owner's messages (newest
 * first), deterministically. "Now" is Wednesday 2026-11-04, 10:00 in Israel.
 */
const NOW = businessInstantMs('2026-11-04', '10:00')
const read = (...oldestFirst: string[]) => readDraft([...oldestFirst].reverse(), NOW)

describe('natural Hebrew day + time, in one message', () => {
  it.each([
    ['מחר ב-12', '2026-11-05', 'בשעה 12:00'],
    ['היום ב-16:30', '2026-11-04', 'בשעה 16:30'],
    ['ביום ראשון בבוקר', '2026-11-08', 'בבוקר'],
    ['בעוד יומיים בשעה 10', '2026-11-06', 'בשעה 10:00'],
    ['להתקשר לאורן מחר ב-12', '2026-11-05', 'בשעה 12:00'],
  ])('"%s"', (words, date, when) => {
    expect(read(words)).toMatchObject({ date, when, problem: null })
  })

  it('"להתקשר לאורן ב-12": the time is kept, the day is still missing', () => {
    expect(read('להתקשר לאורן ב-12')).toMatchObject({ date: null, when: 'בשעה 12:00', problem: null })
  })
})

describe('across messages', () => {
  it('the reported conversation: the time given before the day is kept', () => {
    const d = read('תיצור לי משימה ומעקב מתוך הוואטסאפ', 'Oren kakun', 'לשעה 12:00 להתקשר לאורן')
    expect(d).toMatchObject({ date: null, when: 'בשעה 12:00', problem: null })
    expect(read('תיצור לי משימה ומעקב מתוך הוואטסאפ', 'Oren kakun', 'לשעה 12:00 להתקשר לאורן', 'מחר')).toMatchObject({
      date: '2026-11-05',
      when: 'בשעה 12:00',
      problem: null,
    })
  })

  it('a later day or time replaces an earlier one', () => {
    expect(read('תזכיר לי מחר ב-10', 'בעצם ביום ראשון', 'ב-11:30')).toMatchObject({ date: '2026-11-08', when: 'בשעה 11:30' })
  })

  it('"ב-4" is asked about, and "אחר הצהריים" then settles it as 16:00', () => {
    expect(read('מחר ב-4')).toMatchObject({ date: '2026-11-05', when: null, problem: 'ambiguous_time', hour: 4 })
    expect(read('מחר ב-4', 'אחר הצהריים')).toMatchObject({ date: '2026-11-05', when: 'בשעה 16:00', problem: null })
    expect(read('מחר ב-4', 'בבוקר')).toMatchObject({ when: 'בשעה 04:00', problem: null })
  })

  it('an unclear or past day is a problem, never a guess', () => {
    expect(read('מחר או בעוד שבוע')).toMatchObject({ date: null, problem: 'ambiguous_date' })
    expect(read('ב-01.11')).toMatchObject({ date: null, problem: 'past_date' })
    // …and an answer settles it.
    expect(read('מחר או בעוד שבוע', 'מחר')).toMatchObject({ date: '2026-11-05', problem: null })
  })
})

describe('task or follow-up, in the owner’s words', () => {
  it.each([
    [['תפתח משימה לדני'], 'task'],
    [['תקבע מעקב לדני'], 'follow_up'],
    [['תפתח משימת מעקב לדני'], 'task'],
    [['תיצור לי משימה ומעקב'], null],
    [['תיצור לי משימה ומעקב', 'מעקב'], 'follow_up'],
    [['תזכיר לי לחזור לדני'], null],
  ])('%j → %s', (messages, kind) => {
    expect(read(...messages).kind).toBe(kind)
  })
})

describe('withWhen: the time of day goes into the wording', () => {
  it.each([
    ['להתקשר לאורן', 'בשעה 12:00', 'להתקשר לאורן בשעה 12:00'],
    ['להתקשר לאורן ב-12', 'בשעה 12:00', 'להתקשר לאורן ב-12'],
    ['להתקשר לאורן בשעה 12:00', 'בשעה 12:00', 'להתקשר לאורן בשעה 12:00'],
    ['לחזור לדני', 'בבוקר', 'לחזור לדני בבוקר'],
    ['', 'בשעה 12:00', 'בשעה 12:00'],
    ['לחזור לדני', null, 'לחזור לדני'],
  ])('"%s" + %s → "%s"', (text, when, out) => {
    expect(withWhen(text, when, 255)).toBe(out)
  })

  it('never exceeds the field', () => {
    expect(withWhen('א'.repeat(300), 'בשעה 12:00', 255)).toHaveLength(255)
  })
})

describe('settleWhen: no day named means today, in the business timezone', () => {
  const settle = (words: string, nowMs = NOW, timeRequired = false) =>
    settleWhen(readDraft([words], nowMs), nowMs, { timeRequired })

  it.each([
    ['תיצור משימה להתקשר לדני', '2026-11-04', null],
    ['תקבע פגישה עם אבי בשעה 12:00', '2026-11-04', '12:00'],
    ['תקבע לי למחר ב-12:00', '2026-11-05', '12:00'],
    ['ביום ראשון', '2026-11-08', null],
  ])('"%s" → %s %s', (words, date, time) => {
    expect(settle(words)).toEqual({ ok: true, date, time })
  })

  it('a time already passed today is asked about, never moved or kept in the past', () => {
    expect(settle('תקבע פגישה עם אבי בשעה 09:00')).toMatchObject({ ok: false, ask: 'past_today', time: '09:00' })
    expect(settle('היום ב-09:00')).toMatchObject({ ok: false, ask: 'past_today' })
    // The same hour on an explicit later day is fine.
    expect(settle('מחר ב-09:00')).toEqual({ ok: true, date: '2026-11-05', time: '09:00' })
  })

  it('a meeting needs a time: asked only when required, and a part of the day is not a time', () => {
    expect(settle('תקבע פגישה עם אבי', NOW, true)).toMatchObject({ ok: false, ask: 'ask_time' })
    expect(settle('תקבע פגישה עם אבי בבוקר', NOW, true)).toMatchObject({ ok: false, ask: 'ask_time' })
    expect(settle('תקבע משימה', NOW, false)).toMatchObject({ ok: true })
  })

  it('"today" follows Israel, not the server: 22:30 UTC on Nov 4 is already Nov 5', () => {
    expect(settle('תיצור משימה', Date.UTC(2026, 10, 4, 22, 30))).toEqual({ ok: true, date: '2026-11-05', time: null })
    // 21:30 UTC is still 23:30 on Nov 4 in Israel.
    expect(settle('תיצור משימה', Date.UTC(2026, 10, 4, 21, 30))).toEqual({ ok: true, date: '2026-11-04', time: null })
    // 12:00 "today" at 22:30 UTC is 12:00 on Nov 5 in Israel: still ahead.
    expect(settle('בשעה 12:00', Date.UTC(2026, 10, 4, 22, 30))).toEqual({ ok: true, date: '2026-11-05', time: '12:00' })
  })

  it('an unclear day or hour stays a question', () => {
    expect(settle('מחר או בעוד שבוע')).toMatchObject({ ok: false, ask: 'ambiguous_date' })
    expect(settle('מחר או מחרתיים')).toMatchObject({ ok: false, ask: 'ambiguous_date' })
    expect(settle('מחרתיים')).toEqual({ ok: true, date: '2026-11-06', time: null })
    expect(settle('ב-01.11')).toMatchObject({ ok: false, ask: 'past_date' })
    expect(settle('מחר ב-4')).toMatchObject({ ok: false, ask: 'ambiguous_time', hour: 4 })
  })
})

describe("isClarifyingAnswer: the Agent's own one question", () => {
  it.each([
    [{ headline: 'לאיזה ליד?', claims: [], unknown: null }, true],
    [{ headline: 'יש לך 3 לידים חדשים.', claims: [], unknown: null }, false],
    [{ headline: 'לאיזה ליד?', claims: [{}], unknown: null }, false],
    [{ headline: 'לא ברור?', claims: [], unknown: 'חסר מידע' }, false],
  ])('%j → %s', (answer, expected) => {
    expect(isClarifyingAnswer(answer)).toBe(expected)
  })
})
