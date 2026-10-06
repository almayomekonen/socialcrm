import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { checkTextAnswer } from '@/lib/inbox/autoresponse/questionnaire/validateAnswer'
import { decideQuestionnaireTurn, type SessionSnapshot } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { renderSummary, summaryFields } from '@/lib/inbox/autoresponse/questionnaire/render'

/**
 * Free-text validation: opt-in, deterministic, and never stricter than the
 * question invites. The production reproducer is "לתאריך" accepted as a date
 * (session 22, conversation 13596, 2026-10-06).
 */

describe("validate: 'date'", () => {
  it.each([
    '18.11.2026', '18/11/2026', '18-11-2026', '18.11', '18/11', '18 בנובמבר', '18 בנובמבר 2026', 'נובמבר 2026',
    'יוני 2027', '15 ביוני', 'בקיץ 2027', 'סוף יוני', 'תחילת דצמבר', 'עוד חודש', 'בחודש הבא', 'בעוד שבועיים',
    'בסוף החודש', 'מחר', 'אחרי החגים', 'בחנוכה', 'ביום שישי', '2027', 'אלול', 'כנראה במאי',
    'עוד לא סגרנו, כנראה יוני',
  ])('accepts %j as a date', (value) => {
    expect(checkTextAnswer('date', value)).toEqual({ ok: true })
  })

  it.each([
    'לא נקבע', 'עוד לא נקבע', 'טרם נקבע', 'עדיין אין תאריך', 'עוד לא סגרנו תאריך', 'לא יודע עדיין', 'לא סגור',
    'עוד לא קבענו', 'עדיין לא החלטנו', 'אין לי מושג', 'לא יודעת',
  ])('accepts %j as "not decided yet"', (value) => {
    expect(checkTextAnswer('date', value)).toEqual({ ok: true, notSet: true })
  })

  it.each(['לתאריך', 'תאריך', 'מתי', 'לא הבנתי', 'מה', '?', 'כן', 'לא', 'אין', 'שלום', 'רחובות', 'סטילס', '18', 'ראשון לציון'])(
    'rejects %j',
    (value) => {
      expect(checkTextAnswer('date', value)).toEqual({ ok: false })
    },
  )
})

describe("validate: 'meaningful'", () => {
  it.each(['רחובות', 'אולמי X בראשון', 'גני התערוכה', 'חולון', 'יום הולדת 40', 'צילום בהשראת סרט', 'תל אביב', 'בית'])(
    'accepts %j',
    (value) => expect(checkTextAnswer('meaningful', value)).toEqual({ ok: true }),
  )
  it.each(['איפה', 'מיקום', 'מה', '?', 'כן', 'לא', 'אוקי', 'לא הבנתי', 'מה?', '🙂', 'אחר'])('rejects %j', (value) =>
    expect(checkTextAnswer('meaningful', value)).toEqual({ ok: false }),
  )
})

it('without `validate`, any reply is the answer, exactly as before', () => {
  for (const value of ['לתאריך', '?', 'מה']) expect(checkTextAnswer(undefined, value)).toEqual({ ok: true })
})

// ── The whole turn ──────────────────────────────────────────────────────────

function load(file: string): QuestionnaireDefinition {
  const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8')
  const parsed = parseQuestionnaireDefinition(raw)
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}
const pp = load('perfect-picture.he.json')
const INVALID_DATE = 'לא הצלחתי לזהות תאריך 📅\nאפשר לכתוב תאריך מדויק או משוער. אם עדיין לא נקבע תאריך, כתבו: לא נקבע'
const LOCATION_Q = 'איפה האירוע יתקיים? אפשר לכתוב עיר או שם של אולם'

const atDate = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 22,
  status: 'active',
  currentStepId: 'event_date_celebration',
  answers: { event_type: ['wedding'] },
  invalidCount: 0,
  lastConsumedSequence: 6,
  lastPromptAt: new Date().toISOString(),
  version: 2,
  ...over,
})
const turn = (text: string, session: SessionSnapshot, definition = pp) =>
  decideQuestionnaireTurn({
    definition,
    session,
    inputs: [{ sequence: 7, kind: 'text', text }],
    now: new Date(),
    routedToQuestionnaire: true,
    aiState: 'ai_qualifying',
    humanTookOver: false,
    hasPriorOutbound: true,
    leadStatusTerminal: false,
  })

describe('the production reproducer', () => {
  it('"לתאריך" is re-asked on the same question, with no location question and nothing stored', () => {
    const d = turn('לתאריך', atDate())
    expect(d).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_text', stepId: 'event_date_celebration', invalidCount: 1 })
    if (d.kind !== 'question') return
    expect(d.text).toBe(INVALID_DATE)
    expect(d.text).not.toContain('מזל טוב')
    expect(d.text).not.toContain(LOCATION_Q)
    expect(d.answers).toEqual({ event_type: ['wedding'] })
  })

  it.each(['?', 'מה'])('%j is rejected the same way', (text) => {
    expect(turn(text, atDate())).toMatchObject({ kind: 'question', stepId: 'event_date_celebration', text: INVALID_DATE })
  })

  it('a valid date advances exactly once, to location, keeping the words', () => {
    const d = turn('18.11.2026', atDate())
    expect(d).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'event_location', invalidCount: 0, text: LOCATION_Q })
    if (d.kind === 'question') expect(d.answers).toEqual({ event_type: ['wedding'], event_date_celebration: ['18.11.2026'] })
  })

  it('an approximate date is kept as written, never turned into an exact one', () => {
    const d = turn('יוני 2027', atDate())
    if (d.kind !== 'question') throw new Error('expected a question')
    expect(d.answers.event_date_celebration).toEqual(['יוני 2027'])
  })
})

describe('"not decided yet" is an answer', () => {
  it.each(['לא נקבע', 'עדיין אין תאריך'])('%j advances and is stored as not_set with the words', (text) => {
    const d = turn(text, atDate())
    expect(d).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'event_location', invalidCount: 0 })
    if (d.kind !== 'question') return
    expect(d.answers).toEqual({
      event_type: ['wedding'],
      event_date_celebration: [text],
      'event_date_celebration:state': ['not_set'],
    })
  })

  it('the rep reads "טרם נקבע", never a fabricated date', () => {
    const answers = { event_type: ['wedding'], event_date_celebration: ['עדיין אין תאריך'], 'event_date_celebration:state': ['not_set'] }
    expect(renderSummary(pp, answers, { complete: false })).toContain('תאריך האירוע: טרם נקבע')
    expect(summaryFields(pp, answers)).toContainEqual({ label: 'תאריך האירוע', value: 'טרם נקבע' })
  })

  it('the drone shoot date works the same way', () => {
    const d = turn('עוד לא קבענו', atDate({ currentStepId: 'drone_date', answers: { event_type: ['drone'], drone_city: ['חולון'], drone_permit: ['yes'] } }))
    expect(d).toMatchObject({ kind: 'terminal', status: 'completed' })
    if (d.kind === 'terminal') expect(d.answers['drone_date:state']).toEqual(['not_set'])
  })
})

describe('invalid attempts and priorities', () => {
  it('maxInvalidAttempts=2: re-asked twice, the third non-answer hands off with what was collected', () => {
    expect(pp.maxInvalidAttempts).toBe(2)
    expect(turn('לתאריך', atDate({ invalidCount: 1 }))).toMatchObject({ kind: 'question', invalidCount: 2, text: INVALID_DATE })
    expect(turn('לתאריך', atDate({ invalidCount: 2 }))).toMatchObject({
      kind: 'terminal',
      reason: 'invalid_limit',
      status: 'handed_off',
      text: pp.handoff,
      answers: { event_type: ['wedding'] },
    })
  })

  it('"נציג" at the date question hands off, it is never validated as a date', () => {
    expect(turn('נציג', atDate())).toMatchObject({ kind: 'terminal', reason: 'human_request', status: 'handed_off' })
  })

  it('a meaningful-text question rejects "איפה" and accepts a city', () => {
    const atLocation = atDate({ currentStepId: 'event_location', answers: { event_type: ['wedding'], event_date_celebration: ['יוני'] } })
    expect(turn('איפה', atLocation)).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_text', stepId: 'event_location' })
    expect(turn('רחובות', atLocation)).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'service' })
  })

  it('a definition without `validate` (the session-22 revision) still accepts "לתאריך", as before', () => {
    const rev2 = JSON.parse(JSON.stringify(pp))
    for (const s of rev2.steps) {
      delete s.validate
      delete s.invalidPrompt
    }
    const parsed = parseQuestionnaireDefinition(rev2)
    if (parsed.ok === false) throw new Error('parse')
    expect(turn('לתאריך', atDate(), parsed.definition)).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'event_location' })
  })
})
