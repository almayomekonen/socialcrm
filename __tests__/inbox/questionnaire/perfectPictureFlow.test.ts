import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { decideQuestionnaireTurn, type SessionSnapshot, type TurnDecision } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { renderSummary, SYSTEM_LINES } from '@/lib/inbox/autoresponse/questionnaire/render'

/**
 * Perfect Picture's whole conversation, turn by turn, through the real state
 * machine: entry question, event branch, drone branch, the "other" paths, the
 * one-time congratulations and the conditional website at the end.
 *
 * Each turn applies the decision to the session exactly as the worker does, so
 * what this records is the sequence of messages a customer would receive.
 */

const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8')
const parsed = parseQuestionnaireDefinition(raw)
if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
const pp: QuestionnaireDefinition = parsed.definition

const CONGRATS = 'קודם כל המון מזל טוב 🎉'
const SITE = 'https://picture-perfect.co.il'
const DATE_Q = 'מה תאריך האירוע? 📅\nאפשר לכתוב תאריך מדויק או משוער. אם עדיין לא נקבע תאריך, כתבו: לא נקבע'
const LOCATION_Q = 'איפה האירוע יתקיים? אפשר לכתוב עיר או שם של אולם'
const SERVICE_Q = 'איזה שירות צילום אתם מחפשים?'
const EVENT_DONE = 'צוות Perfect Picture יעבור על הבקשה ויחזור אליכם להמשך בדיקת זמינות והתאמת הצעה לאירוע 📸'
const DRONE_DONE = 'צוות Perfect Picture יחזור אליכם להמשך בדיקה ותיאום הצילום 📸'
const OLD_NOTES_Q = 'יש עוד משהו שחשוב שנדע'

type Run = { sent: string[]; last: TurnDecision; session: SessionSnapshot | null }

/** The customer sends each message in turn; returns every message we sent back. */
function converse(messages: string[], definition = pp): Run {
  let session: SessionSnapshot | null = null
  const sent: string[] = []
  let last: TurnDecision = { kind: 'none', reason: 'not_started', consumeThrough: null }
  let sequence = 0
  for (const body of messages) {
    sequence += 1
    last = decideQuestionnaireTurn({
      definition,
      session,
      inputs: [{ sequence, kind: 'text', text: body }],
      now: new Date('2026-10-06T12:00:00.000Z'),
      routedToQuestionnaire: true,
      aiState: session ? 'ai_qualifying' : 'new',
      humanTookOver: false,
      hasPriorOutbound: sent.length > 0,
      leadStatusTerminal: false,
    })
    if (last.kind === 'question') {
      sent.push(last.text)
      sequence += 1 // our own outbound takes a sequence number too
      session = {
        id: 1,
        status: 'active',
        currentStepId: last.stepId,
        answers: last.answers,
        invalidCount: last.invalidCount,
        lastConsumedSequence: last.consumeThrough,
        lastPromptAt: '2026-10-06T12:00:00.000Z',
        version: (session?.version ?? -1) + 1,
      }
    } else if (last.kind === 'terminal') {
      if (last.text) sent.push(last.text)
      session = session ? { ...session, status: last.status, answers: last.answers } : null
      break
    }
  }
  return { sent, last, session }
}

const count = (sent: string[], needle: string) => sent.filter((m) => m.includes(needle)).length
const answersOf = (run: Run) => (run.last.kind === 'terminal' ? run.last.answers : {})

describe('the opening', () => {
  it('asks the entry question with all seven options and the way to a person', () => {
    const { sent } = converse(['היי'])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('ברוכים הבאים ל־Perfect Picture')
    expect(sent[0]).toContain('איזה אירוע או שירות צילום אתם מחפשים?')
    expect(sent[0]).toContain('5. צילום רחפן / נדל״ן')
    expect(sent[0]).toContain('7. אירוע אחר')
    expect(sent[0]).toContain('לשיחה עם נציג כתבו: נציג')
  })
})

describe('bar / bat mitzvah', () => {
  const run = converse(['היי', 'אני מתכנן בר מצווה לבן שלי', '18.11.2026', 'רחובות', 'הכל'])

  it('congratulates once, with the date question, then location and services', () => {
    expect(run.sent[1]).toBe(`${CONGRATS}\n\n${DATE_Q}`)
    expect(run.sent[2]).toBe(LOCATION_Q)
    expect(run.sent[3]).toContain(SERVICE_Q)
    expect(run.sent[3]).toContain('3. מגנטים בהתאמה אישית')
    expect(count(run.sent, 'מזל טוב')).toBe(1)
    expect(count(run.sent, OLD_NOTES_Q)).toBe(0)
  })

  it('completes with the event closing and the website', () => {
    expect(run.last).toMatchObject({ kind: 'terminal', status: 'completed', complete: true, escalate: true })
    const closing = run.sent[run.sent.length - 1]
    expect(closing).toContain(EVENT_DONE)
    expect(closing).toContain(SITE)
    expect(run.sent).toHaveLength(5)
  })

  it('keeps the canonical answers and the customer words for the rep', () => {
    expect(answersOf(run)).toEqual({
      event_type: ['bar_bat_mitzvah'],
      'event_type:raw': ['אני מתכנן בר מצווה לבן שלי'],
      event_date_celebration: ['18.11.2026'],
      event_location: ['רחובות'],
      service: ['all'],
    })
    expect(renderSummary(pp, answersOf(run), { complete: true })).toContain(
      'סוג האירוע / השירות: בר / בת מצווה (אני מתכנן בר מצווה לבן שלי)',
    )
  })
})

describe('wedding', () => {
  const run = converse(['היי', 'אנחנו מתחתנים', 'יוני 2027', 'גני התערוכה', 'סטילס ווידאו'])
  it('runs the event flow with one congratulations and no website', () => {
    expect(run.sent[1].startsWith(CONGRATS)).toBe(true)
    expect(count(run.sent, 'מזל טוב')).toBe(1)
    expect(run.last).toMatchObject({ kind: 'terminal', status: 'completed' })
    expect(run.sent[run.sent.length - 1]).toContain(EVENT_DONE)
    expect(count(run.sent, SITE)).toBe(0)
    expect(answersOf(run).service).toEqual(['stills', 'video'])
  })
})

describe('henna', () => {
  const run = converse(['היי', 'אנחנו עושים חינה', 'אוגוסט', 'נתניה', 'רוצים מגנטים'])
  it('runs the event flow and includes the website', () => {
    expect(count(run.sent, 'מזל טוב')).toBe(1)
    expect(run.sent[run.sent.length - 1]).toContain(EVENT_DONE)
    expect(run.sent[run.sent.length - 1]).toContain(SITE)
    expect(answersOf(run)).toMatchObject({ event_type: ['henna'], service: ['magnets'] })
  })
})

describe('corporate event', () => {
  const run = converse(['היי', 'יש לנו אירוע חברה', '3.12', 'מלון דן תל אביב', 'עמדת צילום'])
  it('asks the date without congratulations and completes without the website', () => {
    expect(run.sent[1]).toBe(DATE_Q)
    expect(count(run.sent, 'מזל טוב')).toBe(0)
    expect(run.sent[run.sent.length - 1]).toContain(EVENT_DONE)
    expect(count(run.sent, SITE)).toBe(0)
    expect(answersOf(run)).toMatchObject({ event_type: ['business'], event_date: ['3.12'], service: ['booth'] })
  })
})

describe('drone / real estate', () => {
  const run = converse(['היי', 'צריך רחפן לצילום נכס', 'חולון', 'כן', '20.10.2026'])
  it('takes the drone branch: city, permission, date, then its own closing with the website', () => {
    expect(run.sent[1]).toBe('באיזו עיר תרצו לבצע את הצילום / ההטסה?')
    expect(run.sent[2]).toContain('האם יש לכם אישור הטסה באזור?')
    expect(run.sent[2]).toContain('3. לא יודע')
    expect(run.sent[3]).toBe('לאיזה תאריך תרצו לתאם את הצילום? 📅\nאפשר לכתוב תאריך מדויק או משוער. אם עדיין לא נקבע תאריך, כתבו: לא נקבע')
    const closing = run.sent[run.sent.length - 1]
    expect(closing).toContain(DRONE_DONE)
    expect(closing).toContain(SITE)
    expect(closing).not.toContain(EVENT_DONE)
  })

  it('never asks the event questions and never congratulates', () => {
    for (const q of [DATE_Q, LOCATION_Q, SERVICE_Q, 'מזל טוב']) expect(count(run.sent, q)).toBe(0)
    expect(answersOf(run)).toEqual({
      event_type: ['drone'],
      'event_type:raw': ['צריך רחפן לצילום נכס'],
      drone_city: ['חולון'],
      drone_permit: ['yes'],
      drone_date: ['20.10.2026'],
    })
  })

  it.each([
    ['אין לי', 'no'],
    ['לא בטוח', 'unknown'],
  ])('reads %j as permission %s', (answer, option) => {
    const r = converse(['היי', 'צילום נדלן', 'חולון', answer, 'מחר'])
    expect(answersOf(r).drone_permit).toEqual([option])
  })
})

describe('other event', () => {
  const run = converse(['היי', 'אירוע אחר', 'יום הולדת 40 לאמא', 'בסוף החודש', 'הרצליה', '1'])
  it('asks what event, then the event flow without congratulations, then completes without the website', () => {
    expect(run.sent[1]).toBe('בשמחה, איזה אירוע אתם מתכננים?')
    expect(run.sent[2]).toBe(DATE_Q)
    expect(run.sent[3]).toBe(LOCATION_Q)
    expect(run.sent[4]).toContain(SERVICE_Q)
    expect(count(run.sent, 'מזל טוב')).toBe(0)
    expect(count(run.sent, SITE)).toBe(0)
    expect(answersOf(run)).toMatchObject({ event_type: ['other'], event_other: ['יום הולדת 40 לאמא'], service: ['stills'] })
  })
})

describe('other service', () => {
  const run = converse(['היי', 'בר מצווה', '1.1.2027', 'ירושלים', 'אחר', 'צילום בהשראת סרט'])
  it('asks for a short description and keeps both the selection and the words', () => {
    expect(run.sent[4]).toBe('בשמחה, כתבו לנו בקצרה איזה שירות צילום אתם מחפשים.')
    expect(run.last).toMatchObject({ kind: 'terminal', status: 'completed' })
    expect(answersOf(run)).toMatchObject({ service: ['other'], service_other: ['צילום בהשראת סרט'] })
    expect(renderSummary(pp, answersOf(run), { complete: true })).toContain('פירוט השירות: צילום בהשראת סרט')
  })
})

describe('safety', () => {
  it.each([
    ['at the entry question', ['היי', 'נציג']],
    ['in the middle of the event flow', ['היי', 'חתונה', 'נציג']],
    ['in the drone branch', ['היי', 'רחפן', 'חולון', 'אפשר נציג?']],
  ])('"נציג" %s hands off immediately', (_, messages) => {
    const run = converse(messages)
    expect(run.last).toMatchObject({ kind: 'terminal', reason: 'human_request', status: 'handed_off' })
    expect(run.sent[run.sent.length - 1]).toBe(pp.handoff)
  })

  it('an ambiguous entry answer is re-asked with the menu, never guessed', () => {
    const run = converse(['היי', 'עוד לא החלטנו איזה אירוע'])
    expect(run.last).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_choice', stepId: 'event_type' })
    expect(run.sent[1].startsWith(SYSTEM_LINES.invalidChoice)).toBe(true)
  })

  it('an ambiguous service answer is re-asked, never guessed', () => {
    const run = converse(['היי', 'חתונה', 'יוני', 'חיפה', 'לא צריך וידאו'])
    expect(run.last).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_choice', stepId: 'service' })
  })

  it('a person taking over ends the questionnaire in silence', () => {
    const d = decideQuestionnaireTurn({
      definition: pp,
      session: { id: 1, status: 'active', currentStepId: 'event_location', answers: {}, invalidCount: 0, lastConsumedSequence: 3, lastPromptAt: null, version: 2 },
      inputs: [{ sequence: 5, kind: 'text', text: 'רחובות' }],
      now: new Date(),
      routedToQuestionnaire: true,
      aiState: 'ai_qualifying',
      humanTookOver: true,
      hasPriorOutbound: true,
      leadStatusTerminal: false,
    })
    expect(d).toMatchObject({ kind: 'terminal', status: 'human_took_over', text: null })
  })
})

describe('closing links: each route gets only its own', () => {
  const WISEPAGE = 'https://wisepage.wwcrm.co.il/picture-perfect'
  const flows: Array<[string, string[], string | null]> = [
    ['wedding', ['היי', 'אנחנו מתחתנים', 'יוני', 'חיפה', 'סטילס'], WISEPAGE],
    ['bar mitzvah', ['היי', 'בר מצווה', 'מאי', 'רחובות', 'הכל'], SITE],
    ['henna', ['היי', 'אנחנו עושים חינה', 'מאי', 'נתניה', 'וידאו'], SITE],
    ['drone', ['היי', 'צריך רחפן לצילום נכס', 'חולון', 'כן', 'מחר'], SITE],
    ['brit', ['היי', 'יש לנו ברית', 'מחר', 'ראשון לציון', 'סטילס'], null],
    ['business', ['היי', 'יש לנו אירוע חברה', '3.12', 'תל אביב', 'סטילס'], null],
    ['other', ['היי', 'אירוע אחר', 'יום הולדת', 'מאי', 'חולון', 'סטילס'], null],
  ]
  it.each(flows)('%s', (_, messages, url) => {
    const run = converse(messages)
    expect(run.last).toMatchObject({ kind: 'terminal', status: 'completed' })
    const closing = run.sent[run.sent.length - 1]
    for (const link of [SITE, WISEPAGE]) {
      expect(closing.includes(link), link).toBe(link === url)
    }
    if (url === WISEPAGE) expect(closing).toContain('מוזמנים בינתיים להתרשם מחבילות ועבודות לחתונה 💍')
  })
})

describe('icons are presentation only', () => {
  it('the menus show one icon per option', () => {
    const entry = converse(['היי']).sent[0]
    for (const line of ['1. חתונה 💍', '2. בר / בת מצווה 🎉', '3. ברית / בריתה 👶', '4. חינה 🪬', '5. צילום רחפן / נדל״ן 🚁', '6. אירוע עסקי 💼', '7. אירוע אחר ✨']) {
      expect(entry).toContain(line)
    }
    const service = converse(['היי', 'חתונה', 'יוני', 'חיפה']).sent[3]
    for (const line of ['1. סטילס 📸', '2. וידאו 🎥', '3. מגנטים בהתאמה אישית 🧲', '4. עמדת צילום מפוארת 🤳', '5. הכל ✨', '6. אחר 📝']) {
      expect(service).toContain(line)
    }
    const permit = converse(['היי', 'רחפן', 'חולון']).sent[2]
    for (const line of ['1. כן ✅', '2. לא ❌', '3. לא יודע 🤷']) expect(permit).toContain(line)
  })

  it.each([
    ['a number', '1'],
    ['the label without the icon', 'חתונה'],
    ['the menu line copied back', 'חתונה 💍'],
  ])('%s selects wedding and stores no icon and no raw text', (_, reply) => {
    const run = converse(['היי', reply, 'יוני', 'חיפה', 'סטילס'])
    expect(answersOf(run)).toMatchObject({ event_type: ['wedding'] })
    expect(answersOf(run)['event_type:raw']).toBeUndefined()
    const summary = renderSummary(pp, answersOf(run), { complete: true })
    expect(summary).toContain('סוג האירוע / השירות: חתונה\n')
    expect(summary).not.toMatch(/💍|📸/)
  })

  it('natural answers, multi select and "אחר" still work behind the icons', () => {
    expect(answersOf(converse(['היי', 'אני מתכנן בר מצווה', 'מאי', 'רחובות', 'סטילס ווידאו']))).toMatchObject({
      event_type: ['bar_bat_mitzvah'],
      service: ['stills', 'video'],
    })
    expect(answersOf(converse(['היי', 'חתונה', 'יוני', 'חיפה', 'מגנטים'])).service).toEqual(['magnets'])
    expect(answersOf(converse(['היי', 'חתונה', 'יוני', 'חיפה', 'הכל'])).service).toEqual(['all'])
    const other = converse(['היי', 'חתונה', 'יוני', 'חיפה', 'אחר', 'צילום משפחתי'])
    expect(other.sent[4]).toBe('בשמחה, כתבו לנו בקצרה איזה שירות צילום אתם מחפשים.')
    expect(answersOf(other)).toMatchObject({ service: ['other'], service_other: ['צילום משפחתי'] })
    expect(answersOf(converse(['היי', 'צריך רחפן לצילום נכס', 'חולון', 'אין לי מושג', 'מחר'])).drone_permit).toEqual(['unknown'])
  })

  it('an icon with letters in it is rejected', () => {
    const bad = JSON.parse(raw)
    bad.steps[0].options[0].icon = 'VIP'
    expect(parseQuestionnaireDefinition(bad).ok).toBe(false)
  })
})
