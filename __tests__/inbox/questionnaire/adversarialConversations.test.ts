import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { decideQuestionnaireTurn, type InboundInput, type SessionSnapshot, type TurnDecision } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { renderSummary } from '@/lib/inbox/autoresponse/questionnaire/render'
import { inboundInputs } from '@/lib/inbox/autoresponse/questionnaire/turnFacts'

/**
 * Whole conversations from people who do not follow the script: typos,
 * indecision, questions instead of answers, rapid bursts, corrections, "other",
 * media, a request for a person, a rep stepping in, silence, "we don't know
 * yet", several answers in one message.
 *
 * Each scenario ends by inspecting what the rep would get: the stored answers
 * and the summary. The invariant everywhere: nothing is filed under the wrong
 * question, nothing nonsensical becomes an answer, and nobody is trapped.
 */

const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8')
const parsed = parseQuestionnaireDefinition(raw)
if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
const pp: QuestionnaireDefinition = parsed.definition

type Turn =
  | string
  | { texts: string[] }
  | { media: 'media' | 'voice' | 'ignorable' }
  | { takeover: true; text: string }
  | { after: number; text: string } // hours since our last question

type Result = { sent: string[]; decisions: TurnDecision[]; session: SessionSnapshot | null; final: TurnDecision }

function play(turns: Turn[]): Result {
  let session: SessionSnapshot | null = null
  const sent: string[] = []
  const decisions: TurnDecision[] = []
  let seq = 0
  let clock = new Date('2026-10-06T10:00:00.000Z').getTime()
  let final: TurnDecision = { kind: 'none', reason: 'idle', consumeThrough: null }
  for (const t of turns) {
    let inputs: InboundInput[] = []
    let humanTookOver = false
    if (typeof t === 'string') inputs = [{ sequence: ++seq, kind: 'text', text: t }]
    else if ('texts' in t) inputs = t.texts.map((text) => ({ sequence: ++seq, kind: 'text' as const, text }))
    else if ('media' in t) inputs = [{ sequence: ++seq, kind: t.media, text: '' }]
    else if ('takeover' in t) {
      humanTookOver = true
      inputs = [{ sequence: ++seq, kind: 'text', text: t.text }]
    } else {
      clock += t.after * 3600_000
      inputs = [{ sequence: ++seq, kind: 'text', text: t.text }]
    }
    final = decideQuestionnaireTurn({
      definition: pp,
      session,
      inputs,
      now: new Date(clock),
      routedToQuestionnaire: true,
      aiState: session ? 'ai_qualifying' : 'new',
      humanTookOver,
      hasPriorOutbound: sent.length > 0,
      leadStatusTerminal: false,
    })
    decisions.push(final)
    if (final.kind === 'question') {
      sent.push(final.text)
      seq++
      session = {
        id: 1,
        status: 'active',
        currentStepId: final.stepId,
        answers: final.answers,
        invalidCount: final.invalidCount,
        lastConsumedSequence: final.consumeThrough,
        lastPromptAt: new Date(clock).toISOString(),
        version: (session?.version ?? -1) + 1,
      }
    } else if (final.kind === 'terminal') {
      if (final.text) sent.push(final.text)
      session = session ? { ...session, status: final.status, answers: final.answers } : null
      break
    }
  }
  return { sent, decisions, session, final }
}

const summaryOf = (r: Result) => renderSummary(pp, r.session?.answers ?? {}, { complete: r.final.kind === 'terminal' && r.final.complete })
const SITE = 'https://picture-perfect.co.il'
const WISEPAGE = 'https://wisepage.wwcrm.co.il/picture-perfect'
const LOCATION_Q = 'איפה האירוע יתקיים? אפשר לכתוב עיר או שם של אולם'

describe('A. the happy path', () => {
  it('bar mitzvah, natural answers, five messages, website', () => {
    const r = play(['היי', 'אני מתכנן בר מצווה לבן שלי', '18.11.2026', 'רחובות', 'הכל'])
    expect(r.final).toMatchObject({ kind: 'terminal', status: 'completed' })
    expect(r.sent).toHaveLength(5)
    expect(r.sent[4]).toContain(SITE)
    expect(summaryOf(r)).toBe(
      [
        'שאלון וואטסאפ הושלם',
        'סוג האירוע / השירות: בר / בת מצווה (אני מתכנן בר מצווה לבן שלי)',
        'תאריך האירוע: 18.11.2026',
        'מיקום האירוע: רחובות',
        'שירות צילום: הכל',
      ].join('\n'),
    )
  })
})

describe('B. typos, punctuation, repeated letters, emoji', () => {
  it('still completes with clean canonical answers', () => {
    const r = play(['הייי', 'חתונהההה!!', '18/11/26', 'רחובות!!', 'סטילס ווידאו 📸'])
    expect(r.final).toMatchObject({ kind: 'terminal', status: 'completed' })
    expect(r.session?.answers).toMatchObject({ event_type: ['wedding'], service: ['stills', 'video'] })
    expect(r.session?.answers['event_type:raw']).toBeUndefined()
    expect(r.sent[r.sent.length - 1]).toContain(WISEPAGE)
  })
})

describe('C. indecision: invalid attempts are counted per question and reset', () => {
  it('two misses on one question never count against the next', () => {
    const r = play(['היי', 'עוד לא החלטנו', 'חתונה או חינה', '2', 'לתאריך', '?', 'יוני', 'רחובות', 'סטילס'])
    const reasons = r.decisions.map((d) => d.reason)
    expect(reasons).toEqual([
      'started',
      'reprompt_invalid_choice',
      'reprompt_invalid_choice',
      'answered',
      'reprompt_invalid_text',
      'reprompt_invalid_text',
      'answered',
      'answered',
      'completed',
    ])
    const afterEvent = r.decisions[3]
    expect(afterEvent.kind === 'question' && afterEvent.invalidCount).toBe(0)
    expect(r.session?.answers).toMatchObject({ event_type: ['bar_bat_mitzvah'], event_date_celebration: ['יוני'] })
  })

  it('a third miss on the same question hands over with what was collected', () => {
    const r = play(['היי', 'חתונה', 'לתאריך', 'מתי', 'תאריך'])
    expect(r.final).toMatchObject({ kind: 'terminal', reason: 'invalid_limit', status: 'handed_off', text: pp.handoff })
    expect(r.session?.answers).toEqual({ event_type: ['wedding'] })
  })
})

describe('D. questions instead of answers', () => {
  it('is never answered for the customer, and never files a question as an answer', () => {
    const r = play([
      'היי',
      'כמה זה עולה?',
      '1',
      'אתם פנויים ב-18.11?',
      'אתם מגיעים לחיפה?',
      'חיפה',
      'מה ההבדל בין סטילס לוידאו?',
      'סטילס',
    ])
    expect(r.decisions.map((d) => d.reason)).toEqual([
      'started',
      'customer_question',
      'answered',
      'answered', // the date question's answer contains a date: kept, in their words
      'customer_question',
      'answered',
      'customer_question',
      'completed',
    ])
    // Questions are acknowledged, never counted as invalid answers.
    expect(r.sent[4].startsWith('שאלה טובה, נציג מהצוות יענה עליה בהמשך.')).toBe(true)
    expect(r.decisions.every((d) => d.kind !== 'question' || d.invalidCount === 0)).toBe(true)
    expect(r.session?.answers).toMatchObject({
      event_type: ['wedding'],
      event_date_celebration: ['אתם פנויים ב-18.11?'],
      event_location: ['חיפה'],
      service: ['stills'],
    })
  })
})

describe('E. rapid bursts answer one question, and nothing lands on the wrong one', () => {
  it('a burst at the entry question answers only the entry question', () => {
    const r = play(['היי', { texts: ['חתונה', '18.11', 'רחובות'] }])
    expect(r.final).toMatchObject({ kind: 'question', stepId: 'event_date_celebration' })
    expect(r.session?.answers).toEqual({ event_type: ['wedding'], ':unplaced': ['18.11', 'רחובות'] })
  })

  it('a non-answer and its correction in one burst: the correction is not lost', () => {
    const r = play(['היי', 'חתונה', { texts: ['לתאריך', '18.11'] }])
    expect(r.final).toMatchObject({ kind: 'question', stepId: 'event_location' })
    expect(r.session?.answers.event_date_celebration?.[0]).toContain('18.11')
  })
})

describe('F. a change of mind about an earlier answer', () => {
  it('is never stored as the answer to the current question, and is kept for the rep', () => {
    const r = play(['היי', 'חתונה', '18.11', 'טעיתי 19.11', 'רחובות', 'סטילס'])
    expect(r.decisions[3]).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_text', stepId: 'event_location' })
    expect(r.session?.answers.event_location).toEqual(['רחובות'])
    expect(r.session?.answers[':corrections']).toEqual(['טעיתי 19.11'])
    expect(summaryOf(r)).toContain('תיקון מהלקוח (תאריך האירוע): טעיתי 19.11')
  })

  it('"זו בעצם חינה" at the date question re-asks the date and is kept', () => {
    const r = play(['היי', 'חתונה', 'סליחה זו בעצם חינה'])
    expect(r.final).toMatchObject({ kind: 'question', stepId: 'event_date_celebration' })
    expect(r.session?.answers).toEqual({ event_type: ['wedding'], ':corrections': ['סליחה זו בעצם חינה'] })
  })
})

describe('G. "other", both kinds', () => {
  it('describes the event, no congratulations, describes the service, no website', () => {
    const r = play(['היי', 'אירוע אחר', 'הצעת נישואין עם רחפן', 'בסוף החודש', 'חוף הים בהרצליה', 'אחר', 'צילום חופה בלבד'])
    expect(r.final).toMatchObject({ kind: 'terminal', status: 'completed' })
    // "רחפן" in a description never moves the branch: only the canonical answer does.
    expect(r.sent.some((m) => m.includes('אישור הטסה'))).toBe(false)
    expect(r.sent.some((m) => m.includes('מזל טוב'))).toBe(false)
    expect(r.sent[r.sent.length - 1]).not.toContain('http')
    expect(r.session?.answers).toMatchObject({ event_type: ['other'], event_other: ['הצעת נישואין עם רחפן'], service: ['other'], service_other: ['צילום חופה בלבד'] })
  })
})

describe('H. drone with an uncertain permission', () => {
  it('re-asks a contradiction, stores "unknown", allows an open date', () => {
    const r = play(['היי', 'צילום נדלן', 'כמה מקומות במרכז', 'כן אבל לא בטוח', 'לא בטוח', 'לא נקבע'])
    expect(r.decisions[3]).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_choice', stepId: 'drone_permit' })
    expect(r.final).toMatchObject({ kind: 'terminal', status: 'completed' })
    expect(r.sent[r.sent.length - 1]).toContain(SITE)
    const summary = summaryOf(r)
    expect(summary).toContain('אישור הטסה: לא יודע')
    expect(summary).toContain('תאריך הצילום: טרם נקבע')
    expect(summary).not.toMatch(/מיקום האירוע|שירות צילום|תאריך האירוע/)
  })
})

describe('I. media', () => {
  it('image, voice and location pins are re-asked; reactions are ignored; nothing is stored', () => {
    const r = play(['היי', 'חתונה', { media: 'media' }, { media: 'voice' }, { media: 'ignorable' }])
    expect(r.decisions.slice(2).map((d) => d.reason)).toEqual(['reprompt_media', 'reprompt_voice', 'ignorable_only'])
    expect(r.session?.answers).toEqual({ event_type: ['wedding'] })
  })

  it('a caption is read as the customer typing', () => {
    const rows = [
      { direction: 'inbound', type: 'image', text: '', payload: { id: 'm1', caption: '18.11' }, sequence: 9 },
      { direction: 'inbound', type: 'location', text: '', payload: { latitude: 32, longitude: 34 }, sequence: 10 },
      { direction: 'inbound', type: 'sticker', text: '', payload: { id: 's' }, sequence: 11 },
    ]
    expect(inboundInputs(rows, 8)).toEqual([
      { sequence: 9, kind: 'text', text: '18.11', selectedId: undefined },
      { sequence: 10, kind: 'media', text: '', selectedId: undefined },
      { sequence: 11, kind: 'media', text: '', selectedId: undefined },
    ])
  })
})

describe('J. asking for a person, and refusing one', () => {
  it('"אני לא רוצה נציג" is not a handoff; "נציג בבקשה" is, with the answers so far', () => {
    const r = play(['היי', 'חתונה', 'אני לא רוצה נציג', 'נציג בבקשה'])
    expect(r.decisions[2]).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_text' })
    expect(r.final).toMatchObject({ kind: 'terminal', reason: 'human_request', status: 'handed_off', text: pp.handoff })
    expect(r.session?.answers).toEqual({ event_type: ['wedding'] })
  })
})

describe('K. a rep steps in', () => {
  it('ends the questionnaire in silence, keeping the answers', () => {
    const r = play(['היי', 'חתונה', { takeover: true, text: '18.11' }])
    expect(r.final).toMatchObject({ kind: 'terminal', status: 'human_took_over', text: null })
    expect(r.sent.length).toBe(2)
  })
})

describe('L. a replay with nothing new does nothing', () => {
  it('no pending input → no decision, no message', () => {
    const first = play(['היי', 'חתונה'])
    const replay = decideQuestionnaireTurn({
      definition: pp,
      session: first.session,
      inputs: [],
      now: new Date('2026-10-06T10:00:00.000Z'),
      routedToQuestionnaire: true,
      aiState: 'ai_qualifying',
      humanTookOver: false,
      hasPriorOutbound: true,
      leadStatusTerminal: false,
    })
    expect(replay).toMatchObject({ kind: 'none', reason: 'no_pending_inbound' })
  })
})

describe('M. silence', () => {
  it('23 hours later the questionnaire simply continues', () => {
    const r = play(['היי', 'חתונה', { after: 23, text: '18.11' }])
    expect(r.final).toMatchObject({ kind: 'question', stepId: 'event_location' })
  })
  it('more than 24 hours later it hands over with what was collected, and never restarts', () => {
    const r = play(['היי', 'חתונה', { after: 25, text: '18.11' }])
    expect(r.final).toMatchObject({ kind: 'terminal', reason: 'expired', status: 'handed_off', text: pp.handoff })
    expect(r.session?.answers).toEqual({ event_type: ['wedding'] })
  })
})

describe("N. we don't know yet", () => {
  it('date and venue both "not set": the rep reads "טרם נקבע", never a fabricated value', () => {
    const r = play(['היי', 'בת מצווה לילדה', 'עוד לא קבענו', 'עוד לא סגרנו אולם', 'סטילס'])
    expect(r.final).toMatchObject({ kind: 'terminal', status: 'completed' })
    const summary = summaryOf(r)
    expect(summary).toContain('תאריך האירוע: טרם נקבע')
    expect(summary).toContain('מיקום האירוע: טרם נקבע')
    expect(r.session?.answers).toMatchObject({
      event_date_celebration: ['עוד לא קבענו'],
      'event_date_celebration:state': ['not_set'],
      event_location: ['עוד לא סגרנו אולם'],
      'event_location:state': ['not_set'],
    })
  })
})

describe('O. several answers in one message', () => {
  it('answers the open question only; the rest is not guessed into other fields', () => {
    const r = play(['היי', 'חתונה ב-18.11 ברחובות'])
    expect(r.final).toMatchObject({ kind: 'question', stepId: 'event_date_celebration' })
    expect(r.session?.answers).toEqual({ event_type: ['wedding'], 'event_type:raw': ['חתונה ב-18.11 ברחובות'] })
  })
  it('at the date question, the date is accepted in their words and the venue is still asked', () => {
    const r = play(['היי', 'חתונה', '18.11 באולמי X ורוצים סטילס ווידאו'])
    expect(r.final).toMatchObject({ kind: 'question', stepId: 'event_location', text: LOCATION_Q })
    expect(r.session?.answers.service).toBeUndefined()
  })
})
