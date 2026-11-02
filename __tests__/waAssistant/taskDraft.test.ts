import { describe, expect, it } from 'vitest'
import { businessInstantMs } from '@/lib/today/time'
import { isClarifyingAnswer, namedLead, readDraft, withWhen } from '@/lib/waAssistant/tasks/draft'

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

describe('namedLead: the lead the owner named in full', () => {
  const leads = [
    { id: 1, name: 'Oren Kakun' },
    { id: 2, name: 'Oren Levi' },
  ]
  it('takes the one whose full name was written, case-insensitive', () => {
    expect(namedLead(leads, ['לשעה 12:00 להתקשר לאורן', 'Oren kakun'])?.id).toBe(1)
  })
  it('a first name alone, or two full names, picks nobody', () => {
    expect(namedLead(leads, ['Oren'])).toBeNull()
    expect(namedLead(leads, ['Oren Kakun או Oren Levi'])).toBeNull()
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
