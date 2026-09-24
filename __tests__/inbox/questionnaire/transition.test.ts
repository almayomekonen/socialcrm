import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import {
  decideQuestionnaireTurn,
  type InboundInput,
  type SessionSnapshot,
  type TurnFacts,
} from '@/lib/inbox/autoresponse/questionnaire/transition'
import { SYSTEM_LINES, HUMAN_HINT } from '@/lib/inbox/autoresponse/questionnaire/render'

/**
 * Every rule of the conversation, one case each.
 *
 * The property under test throughout: whatever arrives, the machine either asks
 * the next question, re-asks the current one, or ends the session. It never
 * produces a free-form answer and it never says "let the agent handle it" —
 * there is no such outcome in the type.
 */

function definition(): QuestionnaireDefinition {
  const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json'), 'utf8')
  const parsed = parseQuestionnaireDefinition(raw)
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}

const session = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 1,
  status: 'active',
  currentStepId: 'services',
  answers: {},
  invalidCount: 0,
  lastConsumedSequence: 1,
  lastPromptAt: '2026-09-24T09:00:00.000Z',
  version: 0,
  ...over,
})

const text = (body: string, sequence = 2): InboundInput => ({ sequence, kind: 'text', text: body })

const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  definition: definition(),
  session: session(),
  inputs: [text('1')],
  now: new Date('2026-09-24T09:05:00.000Z'),
  routedToQuestionnaire: true,
  aiState: 'ai_qualifying',
  humanTookOver: false,
  hasPriorOutbound: true,
  leadStatusTerminal: false,
  ...over,
})

describe('starting', () => {
  it('opens with the welcome, the first menu and how to reach a person', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: null, aiState: 'new', hasPriorOutbound: false, inputs: [text('שלום', 1)] }),
    )
    expect(d.kind).toBe('question')
    if (d.kind !== 'question') return
    expect(d.startsSession).toBe(true)
    expect(d.stepId).toBe('services')
    expect(d.text).toContain('תודה שפניתם אלינו')
    expect(d.text).toContain('1. צילום סטילס')
    expect(d.text).toContain(HUMAN_HINT)
    // The opening message is consumed as a greeting, never as an answer.
    expect(d.answers).toEqual({})
  })

  it('does not start on a conversation that already has history', () => {
    const d = decideQuestionnaireTurn(facts({ session: null, aiState: 'new', hasPriorOutbound: true }))
    expect(d).toMatchObject({ kind: 'none', reason: 'not_eligible_existing' })
  })

  it('does not start on a conversation the agent already owns', () => {
    const d = decideQuestionnaireTurn(facts({ session: null, aiState: 'ai_qualifying', hasPriorOutbound: false }))
    expect(d).toMatchObject({ kind: 'none', reason: 'not_eligible_state' })
  })

  it('does not start for a closed or lost ליד', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: null, aiState: 'new', hasPriorOutbound: false, leadStatusTerminal: true }),
    )
    expect(d).toMatchObject({ kind: 'none', reason: 'lead_terminal' })
  })

  it('does not start a second time once a session has ended', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ status: 'completed' }), aiState: 'escalated', inputs: [text('היי')] }),
    )
    expect(d).toMatchObject({ kind: 'none', reason: 'session_closed' })
  })
})

describe('answering', () => {
  it('moves to the next question', () => {
    const d = decideQuestionnaireTurn(facts({ inputs: [text('1')] }))
    expect(d.kind).toBe('question')
    if (d.kind !== 'question') return
    expect(d.answers).toEqual({ services: ['stills'] })
    expect(d.stepId).toBe('event_type')
    expect(d.invalidCount).toBe(0)
  })

  it('takes the newest readable selection when the customer corrects themselves', () => {
    const d = decideQuestionnaireTurn(facts({ inputs: [text('1', 2), text('לא, 2', 3), text('2', 4)] }))
    expect(d.kind === 'question' && d.answers).toEqual({ services: ['video'] })
    expect(d.kind === 'question' && d.consumeThrough).toBe(4)
  })

  it('skips a question whose condition is unmet', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ currentStepId: 'event_type', answers: { services: ['stills'] } }), inputs: [text('3')] }),
    )
    // brit, so the wedding-coverage question does not apply
    expect(d.kind === 'question' && d.stepId).toBe('event_date')
  })

  it('asks the conditional question when it does apply', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ currentStepId: 'event_type', answers: { services: ['stills'] } }), inputs: [text('1')] }),
    )
    expect(d.kind === 'question' && d.stepId).toBe('wedding_coverage')
  })

  it('completes after the last question, with the closing message', () => {
    const d = decideQuestionnaireTurn(
      facts({
        session: session({
          currentStepId: 'area',
          answers: { services: ['stills'], event_type: ['brit'], event_date: ['מרץ'], guests: ['80'] },
        }),
        inputs: [text('חיפה')],
      }),
    )
    expect(d.kind).toBe('terminal')
    if (d.kind !== 'terminal') return
    expect(d.status).toBe('completed')
    expect(d.complete).toBe(true)
    expect(d.escalate).toBe(true)
    expect(d.text).toContain('קיבלנו את הפרטים')
    expect(d.answers.area).toEqual(['חיפה'])
  })
})

describe('what it cannot read', () => {
  it('re-asks the same question and counts the attempt', () => {
    const d = decideQuestionnaireTurn(facts({ inputs: [text('אולי מחר')] }))
    expect(d.kind).toBe('question')
    if (d.kind !== 'question') return
    expect(d.stepId).toBe('services')
    expect(d.invalidCount).toBe(1)
    expect(d.text).toContain(SYSTEM_LINES.invalidChoice)
    expect(d.text).toContain('1. צילום סטילס')
  })

  it('says so plainly when several were picked but one was asked for', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ currentStepId: 'event_type', answers: { services: ['stills'] } }), inputs: [text('1,2')] }),
    )
    expect(d.kind === 'question' && d.text).toContain(SYSTEM_LINES.invalidMulti)
  })

  it('hands over to a person after the configured number of attempts, never to the AI', () => {
    const d = decideQuestionnaireTurn(facts({ session: session({ invalidCount: 2 }), inputs: [text('מה?')] }))
    expect(d.kind).toBe('terminal')
    if (d.kind !== 'terminal') return
    expect(d.status).toBe('handed_off')
    expect(d.reason).toBe('invalid_limit')
    expect(d.escalate).toBe(true)
  })

  it('asks for text when a photo arrives', () => {
    const d = decideQuestionnaireTurn(facts({ inputs: [{ sequence: 2, kind: 'media', text: '' }] }))
    expect(d.kind === 'question' && d.text).toContain(SYSTEM_LINES.mediaOnly)
  })

  it('says it cannot listen to a voice note, rather than ignoring it', () => {
    const d = decideQuestionnaireTurn(facts({ inputs: [{ sequence: 2, kind: 'voice', text: '' }] }))
    expect(d.kind === 'question' && d.text).toContain(SYSTEM_LINES.voiceOnly)
  })

  it('stays silent for a reaction, and marks it read', () => {
    const d = decideQuestionnaireTurn(facts({ inputs: [{ sequence: 7, kind: 'ignorable', text: '' }] }))
    expect(d).toMatchObject({ kind: 'none', reason: 'ignorable_only', consumeThrough: 7 })
  })
})

describe('commands', () => {
  it('stops silently on an opt out, and saves what it has', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ answers: { services: ['stills'] } }), inputs: [text('תפסיקו')] }),
    )
    expect(d.kind).toBe('terminal')
    if (d.kind !== 'terminal') return
    expect(d.status).toBe('opted_out')
    expect(d.text).toBeNull()
    expect(d.escalate).toBe(false)
    expect(d.answers).toEqual({ services: ['stills'] })
  })

  it('hands over when asked for a person, keeping the partial answers', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ answers: { services: ['video'] } }), inputs: [text('אפשר לדבר עם נציג')] }),
    )
    expect(d.kind).toBe('terminal')
    if (d.kind !== 'terminal') return
    expect(d.status).toBe('handed_off')
    expect(d.reason).toBe('human_request')
    expect(d.answers).toEqual({ services: ['video'] })
    expect(d.complete).toBe(false)
  })

  it('restarts from the first question and forgets the earlier answers', () => {
    const d = decideQuestionnaireTurn(
      facts({ session: session({ currentStepId: 'guests', answers: { services: ['video'] } }), inputs: [text('מההתחלה')] }),
    )
    expect(d.kind).toBe('question')
    if (d.kind !== 'question') return
    expect(d.stepId).toBe('services')
    expect(d.answers).toEqual({})
    expect(d.text).toContain(SYSTEM_LINES.restarted)
  })

  it('will not restart a conversation that has no live session', () => {
    const d = decideQuestionnaireTurn(facts({ session: session({ status: 'completed' }), inputs: [text('מההתחלה')] }))
    expect(d).toMatchObject({ kind: 'none', reason: 'session_closed' })
  })
})

describe('people and switches', () => {
  it('steps aside the moment a rep has written in the thread', () => {
    const d = decideQuestionnaireTurn(facts({ humanTookOver: true, inputs: [text('1')] }))
    expect(d.kind).toBe('terminal')
    if (d.kind !== 'terminal') return
    expect(d.status).toBe('human_took_over')
    expect(d.text).toBeNull()
    expect(d.escalate).toBe(false)
  })

  it('stays out of a conversation the customer opted out of', () => {
    expect(decideQuestionnaireTurn(facts({ aiState: 'opted_out' }))).toMatchObject({ kind: 'none', reason: 'opted_out' })
  })

  it('hands a live session to a person when the feature is switched off, and never to the AI', () => {
    const d = decideQuestionnaireTurn(facts({ routedToQuestionnaire: false }))
    expect(d.kind).toBe('terminal')
    if (d.kind !== 'terminal') return
    expect(d.status).toBe('handed_off')
    expect(d.reason).toBe('engine_disabled')
    expect(d.escalate).toBe(true)
  })

  it('says nothing at all when it is switched off and no session was running', () => {
    expect(decideQuestionnaireTurn(facts({ routedToQuestionnaire: false, session: null }))).toMatchObject({
      kind: 'none',
      reason: 'not_routed',
    })
  })

  it('hands over a session the customer returns to days later', () => {
    const d = decideQuestionnaireTurn(
      facts({
        session: session({ lastPromptAt: '2026-09-20T09:00:00.000Z' }),
        now: new Date('2026-09-24T09:00:00.000Z'),
        inputs: [text('סליחה על העיכוב')],
      }),
    )
    expect(d.kind === 'terminal' && d.reason).toBe('expired')
  })

  it('hands over when the configuration no longer contains the step it was on', () => {
    const d = decideQuestionnaireTurn(facts({ session: session({ currentStepId: 'deleted_step' }) }))
    expect(d.kind === 'terminal' && d.reason).toBe('step_missing')
  })

  it('does nothing when there is nothing new to answer', () => {
    expect(decideQuestionnaireTurn(facts({ inputs: [] }))).toMatchObject({ kind: 'none', reason: 'no_pending_inbound' })
  })
})
