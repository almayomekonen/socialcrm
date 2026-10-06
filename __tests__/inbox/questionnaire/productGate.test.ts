import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { decideQuestionnaireTurn, MAX_CUSTOMER_QUESTIONS, type InboundInput, type SessionSnapshot } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { renderSummary, summaryFields, SYSTEM_LINES } from '@/lib/inbox/autoresponse/questionnaire/render'
import { detectCommand } from '@/lib/inbox/autoresponse/questionnaire/parseAnswer'
import { detectOptOut } from '@/lib/inbox/autoresponse/optOutDetect'

/**
 * The product gate before the engine becomes generic behaviour. Five decisions:
 *
 *   1. rapid messages: nothing a customer wrote disappears
 *   2. bursts at free text: one message is one candidate, never glued together
 *   3. corrections: a known-wrong value never reads as confirmed truth
 *   4. customer questions: not malformed answers, not counted as such
 *   5. opt-out: negation does not opt out; "not interested" is not compliance
 */

function load(file: string): QuestionnaireDefinition {
  const parsed = parseQuestionnaireDefinition(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'))
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}
const pp = load('perfect-picture.he.json')

const at = (stepId: string, answers: Record<string, string[]> = {}, over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 7,
  status: 'active',
  currentStepId: stepId,
  answers,
  invalidCount: 0,
  lastConsumedSequence: 10,
  lastPromptAt: '2026-10-06T10:00:00.000Z',
  version: 3,
  ...over,
})
const msgs = (...texts: string[]): InboundInput[] => texts.map((text, i) => ({ sequence: 11 + i, kind: 'text', text }))
const turn = (session: SessionSnapshot, inputs: InboundInput[], firstAskedAt = 10, definition = pp) =>
  decideQuestionnaireTurn({
    definition,
    session,
    inputs,
    now: new Date('2026-10-06T10:05:00.000Z'),
    routedToQuestionnaire: true,
    aiState: 'ai_qualifying',
    humanTookOver: false,
    hasPriorOutbound: true,
    leadStatusTerminal: false,
    firstAskedAt,
  })
const answersOf = (d: ReturnType<typeof turn>) => (d.kind === 'none' ? {} : d.answers)

describe('1. rapid messages at a choice question', () => {
  it('"חתונה", "18.11", "רחובות": the choice is answered, the rest is kept for the rep, nothing is misfiled', () => {
    const d = turn(at('event_type'), msgs('חתונה', '18.11', 'רחובות'))
    expect(d).toMatchObject({ kind: 'question', stepId: 'event_date_celebration', consumeThrough: 13 })
    expect(answersOf(d)).toEqual({ event_type: ['wedding'], ':unplaced': ['18.11', 'רחובות'] })
    expect(summaryFields(pp, answersOf(d))).toEqual([
      { label: 'סוג האירוע / השירות', value: 'חתונה' },
      { label: 'הודעה נוספת מהלקוח', value: '18.11' },
      { label: 'הודעה נוספת מהלקוח', value: 'רחובות' },
    ])
  })

  it('a self-correction inside the burst still wins, and is not surfaced as noise', () => {
    expect(answersOf(turn(at('event_type'), msgs('1', 'לא, 2', '2')))).toEqual({ event_type: ['bar_bat_mitzvah'] })
  })

  it('messages sent before this question was asked are kept, and the turn says nothing', () => {
    const d = turn(at('event_location', { event_type: ['wedding'], event_date_celebration: ['18.11'] }), msgs('רחובות'), 12)
    expect(d).toMatchObject({ kind: 'record', stepId: 'event_location', invalidCount: 0 })
    expect(answersOf(d)).toMatchObject({ ':unplaced': ['רחובות'] })
    expect(answersOf(d).event_location).toBeUndefined()
  })

  it('a re-ask does not make the correct answer "too early": "לתאריך" then "18.11" answers the date', () => {
    const afterReask = at('event_date_celebration', { event_type: ['wedding'] }, { invalidCount: 1, lastConsumedSequence: 11 })
    // First asked at 10; "לתאריך" was 11, re-asked at 13, "18.11" was 12.
    const d = turn(afterReask, [{ sequence: 12, kind: 'text', text: '18.11' }], 10)
    expect(d).toMatchObject({ kind: 'question', stepId: 'event_location' })
    expect(answersOf(d).event_date_celebration).toEqual(['18.11'])
  })
})

describe('2. bursts at free text are never glued together', () => {
  it('location: "רחובות", "סטילס" → location is רחובות; סטילס is kept, not merged', () => {
    const d = turn(at('event_location', { event_type: ['wedding'] }), msgs('רחובות', 'סטילס'))
    expect(answersOf(d)).toMatchObject({ event_location: ['רחובות'], ':unplaced': ['סטילס'] })
  })

  it('date: "18.11", "רחובות" → date is 18.11; רחובות is kept, not merged', () => {
    const d = turn(at('event_date_celebration', { event_type: ['wedding'] }), msgs('18.11', 'רחובות'))
    expect(answersOf(d)).toMatchObject({ event_date_celebration: ['18.11'], ':unplaced': ['רחובות'] })
  })

  it('date: "18.11", "בעצם 19.11" → the newer date wins', () => {
    expect(answersOf(turn(at('event_date_celebration', { event_type: ['wedding'] }), msgs('18.11', '19.11'))).event_date_celebration).toEqual(['19.11'])
  })

  it('an unvalidated text question (no `validate`) takes the first message; the second is kept', () => {
    const sample = load('event-photography.he.json')
    const textStep = sample.steps.find((s) => s.type === 'text')!
    const d = turn(at(textStep.id), msgs('בתל אביב', 'או בחיפה'), 10, sample)
    expect(answersOf(d)).toMatchObject({ [textStep.id]: ['בתל אביב'], ':unplaced': ['או בחיפה'] })
  })
})

describe('3. corrections never leave a known-wrong value looking confirmed', () => {
  const answered = { event_type: ['wedding'], event_date_celebration: ['18.11'] }

  it('a date correction flags the date answer and the summary title; nothing is overwritten', () => {
    const d = turn(at('event_location', answered), msgs('טעיתי, 19.11'))
    expect(d).toMatchObject({ kind: 'question', stepId: 'event_location', reason: 'reprompt_invalid_text' })
    expect(answersOf(d).event_date_celebration).toEqual(['18.11'])
    const summary = renderSummary(pp, answersOf(d), { complete: true })
    expect(summary).toContain('שאלון וואטסאפ הושלם (כולל תיקון מהלקוח, דורש אימות)')
    expect(summary).toContain('תאריך האירוע: 18.11 (הלקוח שלח תיקון, דורש אימות)')
    expect(summary).toContain('תיקון מהלקוח (תאריך האירוע): טעיתי, 19.11')
  })

  it('a choice correction flags the choice', () => {
    const d = turn(at('event_location', answered), msgs('סליחה, בעצם זו חינה'))
    const summary = renderSummary(pp, answersOf(d), { complete: false })
    expect(summary).toContain('סוג האירוע / השירות: חתונה (הלקוח שלח תיקון, דורש אימות)')
  })

  it('a correction that fits no single answer is shown unattributed, and still flags the title', () => {
    const d = turn(at('event_location', answered), msgs('טעיתי במשהו'))
    const summary = renderSummary(pp, answersOf(d), { complete: false })
    expect(summary).toContain('(כולל תיקון מהלקוח, דורש אימות)')
    expect(summary).toContain('תיקון מהלקוח (לא שויך לשאלה): טעיתי במשהו')
  })
})

describe('4. a customer question is not a malformed answer', () => {
  it('"כמה זה עולה?" is acknowledged, the question re-asked, and the invalid count untouched', () => {
    const d = turn(at('event_type', {}, { invalidCount: 1 }), msgs('כמה זה עולה?'))
    expect(d).toMatchObject({ kind: 'question', reason: 'customer_question', stepId: 'event_type', invalidCount: 1 })
    if (d.kind !== 'question') return
    expect(d.text.startsWith(SYSTEM_LINES.questionAck)).toBe(true)
    expect(answersOf(d)).toEqual({ ':questions': ['כמה זה עולה?'] })
  })

  it('at the congratulations question, the re-ask does not congratulate again', () => {
    const d = turn(at('event_date_celebration', { event_type: ['wedding'] }), msgs('אתם פנויים בתאריך הזה?'))
    expect(d).toMatchObject({ kind: 'question', reason: 'customer_question' })
    if (d.kind === 'question') expect(d.text).not.toContain('מזל טוב')
  })

  it('"אתם מגיעים לחיפה?" and "מה ההבדל בין סטילס לוידאו?" are questions too', () => {
    expect(turn(at('event_location', { event_type: ['wedding'] }), msgs('אתם מגיעים לחיפה?'))).toMatchObject({ reason: 'customer_question' })
    expect(turn(at('service', { event_type: ['wedding'] }), msgs('מה ההבדל בין סטילס לוידאו?'))).toMatchObject({ reason: 'customer_question' })
  })

  it('a bare "מה?" is confusion, counted as an invalid answer, not a question', () => {
    expect(turn(at('event_type'), msgs('מה?'))).toMatchObject({ reason: 'reprompt_invalid_choice', invalidCount: 1 })
  })

  it(`a person takes over after ${MAX_CUSTOMER_QUESTIONS} questions, by its own policy`, () => {
    const asked = { ':questions': ['כמה זה עולה?', 'אתם מצלמים גם בצפון?', 'יש לכם דוגמאות?'] }
    expect(turn(at('event_type', asked), msgs('ומה עם וידאו?'))).toMatchObject({ kind: 'terminal', reason: 'customer_questions', status: 'handed_off' })
  })
})

describe('5. opt-out and "not interested"', () => {
  it.each(['אני לא רוצה להסיר', 'לא להסיר', 'אל תסירו', 'אני לא מבקש להסיר', 'אין צורך להסיר', 'אל תפסיקו'])('%j does not opt out', (t) => {
    expect(detectOptOut(t)).toBe(false)
  })
  it.each(['תסירו אותי', 'אני רוצה להסיר', 'תפסיקו לשלוח', 'אל תשלחו לי יותר', 'STOP', 'לא, להסיר אותי', 'לא להסיר, אבל תפסיקו לשלוח'])('%j opts out', (t) => {
    expect(detectOptOut(t)).toBe(true)
  })

  it('"לא מעוניין" alone ends the questionnaire quietly for a rep; it is not an opt-out', () => {
    expect(detectOptOut('לא מעוניין')).toBe(false)
    expect(detectCommand('לא מעוניין')).toBe('decline')
    const d = turn(at('event_date_celebration', { event_type: ['wedding'] }), msgs('לא מעוניין, תודה'))
    expect(d).toMatchObject({ kind: 'terminal', reason: 'declined', status: 'handed_off', text: null, escalate: true })
  })

  it('"לא מעוניין בוידאו" is an answer to read, not a command', () => {
    expect(detectCommand('לא מעוניין בוידאו')).toBeNull()
  })
})
