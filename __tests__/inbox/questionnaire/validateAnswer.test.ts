import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { checkTextAnswer, withCorrections } from '@/lib/inbox/autoresponse/questionnaire/validateAnswer'

/**
 * Free-text validation, field by field. Opt-in, deterministic, and never
 * stricter than the question invites: broad text accepts the plausible, a
 * structured field rejects what is clearly not one, and "not decided yet" is an
 * answer only where the question allows it.
 *
 * The production reproducer: "לתאריך" accepted as an event date (agency 158,
 * session 22, conversation 13596, 2026-10-06).
 */

const DATE = { validate: 'date', allowNotSet: true } as const
const DATE_STRICT = { validate: 'date' } as const
const PLACE = { validate: 'meaningful', allowNotSet: true } as const
const TEXT = { validate: 'meaningful' } as const

const verdict = (rules: Parameters<typeof checkTextAnswer>[0], value: string) => {
  const r = checkTextAnswer(rules, value)
  if (r.ok === false) return r.reason
  return r.notSet ? 'not_set' : 'accept'
}

describe('date', () => {
  it.each([
    '18.11.2026', '18/11/2026', '18-11-2026', '18.11', '18/11', '18.11.26', '2026-11-18', '18 בנובמבר',
    '18 בנובמבר 2026', 'נובמבר 2026', 'יוני 2027', '15 ביוני', 'בקיץ 2027', 'סוף יוני', 'תחילת דצמבר', 'עוד חודש',
    'בחודש הבא', 'בעוד שבועיים', 'בעוד 3 חודשים', 'בסוף החודש', 'מחר', 'אחרי החגים', 'אחרי פסח', 'בחנוכה',
    'ביום שישי', 'בשבת', 'סוף שבוע', 'סופ"ש', '2027', 'אלול', 'כנראה במאי', '18 לחודש', 'גמיש', 'תאריך גמיש',
    'מתי שנוח לכם', '18.11.2026 📅', 'דצמבר 2026!!!', 'נובמבר?',
    // Uncertainty with a real period in it is a date, never "not set".
    'לא יודע עדיין, כנראה יוני', 'עוד לא סגרנו, כנראה יוני',
    // The question contains the answer: accepted, words kept for the rep.
    'אתם פנויים ב-18.11?',
    // At the date question a correction IS the date.
    'טעיתי 19.11',
  ])('accepts %j', (value) => expect(verdict(DATE, value)).toBe('accept'))

  it.each(['לא נקבע', 'עוד לא נקבע', 'טרם נקבע', 'עדיין אין תאריך', 'עוד לא סגרנו תאריך', 'לא יודע עדיין', 'לא סגור', 'עוד לא קבענו', 'אין לי מושג', 'לא יודעת'])(
    '%j is "not decided yet"',
    (value) => expect(verdict(DATE, value)).toBe('not_set'),
  )

  it.each([
    'לתאריך', 'תאריך', 'מתי', 'לא הבנתי', 'מה', '?', '📅', 'כן', 'לא', 'אין', 'שלום', 'רחובות', 'סטילס', '18', 'ה-18',
    // Impossible numbers, durations, phones, prices, counts.
    '32.13', '00.00', '2 ימים', '3 חודשים', 'שנה', 'חודש', '050-1234567', '0501234567', '1500', '₪1500', '300 איש',
    // Look-alikes.
    'מושבת', 'ראשון לציון', 'לא יודע מה זה', 'כמה עולה',
  ])('rejects %j', (value) => expect(checkTextAnswer(DATE, value).ok).toBe(false))

  it('without allowNotSet, "not decided" is not accepted', () => {
    expect(checkTextAnswer(DATE_STRICT, 'לא נקבע').ok).toBe(false)
  })
})

describe('event location (meaningful, not-set allowed)', () => {
  it.each([
    'רחובות', 'תל אביב', 'ראשל״צ', 'ראשון', 'אולמי X', 'באולם', 'בבית', 'אצלנו בבית', 'בחצר', 'במושב', 'בצפון',
    'בדרום', 'באזור המרכז', 'ליד רחובות', 'tel aviv', 'ברחובות?', 'עוד לא סגרנו אולם, כנראה ברחובות',
  ])('accepts %j', (value) => expect(verdict(PLACE, value)).toBe('accept'))

  it.each(['עוד לא סגרנו אולם', 'עדיין לא יודעים איפה', 'לא יודע', 'עוד לא ידוע', 'אין מיקום סופי'])('%j is not set', (value) =>
    expect(verdict(PLACE, value)).toBe('not_set'),
  )

  it.each([
    ['איפה', 'not_an_answer'],
    ['מיקום', 'not_an_answer'],
    ['?', 'not_an_answer'],
    ['כן', 'not_an_answer'],
    ['18.11', 'not_an_answer'],
    ['300', 'not_an_answer'],
    ['לא מעוניין', 'not_an_answer'],
    ['כמה זה עולה', 'not_an_answer'],
    ['אני לא רוצה נציג', 'not_an_answer'],
    ['אתם מגיעים לחיפה?', 'question'],
    ['מה ההבדל בין סטילס לוידאו', 'question'],
    ['טעיתי 19.11', 'correction'],
    ['בעצם זו חינה', 'correction'],
  ])('rejects %j (%s)', (value, reason) => expect(verdict(PLACE, value)).toBe(reason))
})

describe('drone location (meaningful, not-set allowed)', () => {
  it.each(['חולון', 'באזור חולון', 'ליד ראשון', 'באתר בנייה', 'בשטח', 'כמה מקומות'])('accepts %j', (value) =>
    expect(verdict(PLACE, value)).toBe('accept'),
  )
})

describe('descriptions: other event, custom service (meaningful only)', () => {
  it.each(['יום הולדת', 'הצעת נישואין', 'מסיבת רווקים', 'אירוע משפחתי', 'אירוע קטן', 'צילום זוגיות', 'אלבום', 'עריכה', 'צילום חופה בלבד', 'צלם לשעתיים', 'צילום משפחתי', 'משהו קטן'])(
    'accepts %j',
    (value) => expect(verdict(TEXT, value)).toBe('accept'),
  )
  it.each(['לא יודע', 'אחר', 'משהו', 'כן', '?', 'אירוע', 'משהו אחר'])('re-asks %j', (value) =>
    expect(checkTextAnswer(TEXT, value).ok).toBe(false),
  )
})

it('without `validate`, any reply is the answer, exactly as before', () => {
  for (const value of ['לתאריך', '?', 'מה', 'טעיתי 19.11', 'לא נקבע']) expect(checkTextAnswer({}, value)).toEqual({ ok: true })
})

describe('corrections are kept, once each', () => {
  it('records a correction and ignores ordinary replies', () => {
    const a = withCorrections({ event_type: ['wedding'] }, ['טעיתי 19.11', 'רחובות'])
    expect(a).toEqual({ event_type: ['wedding'], ':corrections': ['טעיתי 19.11'] })
    expect(withCorrections(a, ['טעיתי 19.11'])).toBe(a)
  })
})

describe('definition rules', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))
  it('allowNotSet without validate is rejected', () => {
    const bad = JSON.parse(JSON.stringify(raw))
    const step = bad.steps.find((s: { id: string }) => s.id === 'event_other')
    delete step.validate
    step.allowNotSet = true
    expect(parseQuestionnaireDefinition(bad).ok).toBe(false)
  })
})
