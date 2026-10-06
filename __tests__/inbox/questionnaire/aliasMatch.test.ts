import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseQuestionnaireDefinition,
  type QuestionnaireChoiceStep,
  type QuestionnaireDefinition,
} from '@/lib/inbox/autoresponse/questionnaire/definition'
import { parseChoice } from '@/lib/inbox/autoresponse/questionnaire/parseAnswer'
import { decideQuestionnaireTurn, type TurnFacts } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { renderSummary, SYSTEM_LINES } from '@/lib/inbox/autoresponse/questionnaire/render'

/**
 * Natural answers to a choice question, read from the business's own aliases.
 *
 * The bar: an obvious answer ("אני מתכנן חתונה") selects its option instantly
 * and with no model; an unclear one re-prompts exactly as before; a step with no
 * aliases behaves exactly as it always did.
 */

function load(file: string): QuestionnaireDefinition {
  const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8')
  const parsed = parseQuestionnaireDefinition(raw)
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}

const pp = load('perfect-picture.he.json')
const eventStep = pp.steps[0] as QuestionnaireChoiceStep
const pick = (text: string, step: QuestionnaireChoiceStep = eventStep) => {
  const r = parseChoice(text, step)
  return r.ok ? r.optionIds : null
}

describe('Perfect Picture: natural event answers', () => {
  it.each([
    ['חתונה', 'wedding'],
    ['אני מתכנן חתונה', 'wedding'],
    ['אנחנו מתחתנים', 'wedding'],
    ['אני מתחתנת בדצמבר', 'wedding'],
    ['יש לנו חתונה', 'wedding'],
    ['אנחנו לפני החתונה ורוצים לבדוק צילום', 'wedding'],
    ['מחפשים צלם לחתונה', 'wedding'],
    ['חתונה ב-18.12 בראשון לציון', 'wedding'],
    ['בר מצווה', 'bar_bat_mitzvah'],
    ['בת מצווה', 'bar_bat_mitzvah'],
    ['אני מתכנן בר מצווה', 'bar_bat_mitzvah'],
    ['אני מתכנן בר מצווה לבן שלי', 'bar_bat_mitzvah'],
    ['יש לילדה בת מצווה', 'bar_bat_mitzvah'],
    ['מחפש צילום לבר מצווה', 'bar_bat_mitzvah'],
    ['בר-מצווה', 'bar_bat_mitzvah'],
    ['בר/בת מצווה', 'bar_bat_mitzvah'],
    ['ברית', 'brit'],
    ['בריתה', 'brit'],
    ['יש לנו ברית', 'brit'],
    ['ברית לבן', 'brit'],
    ['צילום לבריתה', 'brit'],
    ['חינה', 'henna'],
    ['יש לנו חינה', 'henna'],
    ['מחפשים צילום לחינה', 'henna'],
    ['אירוע עסקי', 'business'],
    ['אירוע חברה', 'business'],
    ['יש לנו אירוע חברה', 'business'],
    ['כנס', 'business'],
    ['אירוע לעובדים', 'business'],
    ['אירוע של החברה', 'business'],
    ['יום הולדת 40', 'other'],
  ])('reads %j as %s', (input, expected) => {
    expect(pick(input)).toEqual([expected])
    const isLabel = eventStep.options.some((o) => o.label === input)
    expect(parseChoice(input, eventStep)).toMatchObject(isLabel ? { ok: true } : { via: 'alias' })
  })

  it('still reads numbers and exact labels, without marking them as natural', () => {
    expect(parseChoice('2', eventStep)).toEqual({ ok: true, optionIds: ['bar_bat_mitzvah'] })
    expect(parseChoice('חינה', eventStep)).toEqual({ ok: true, optionIds: ['henna'] })
    expect(parseChoice('בר / בת מצווה', eventStep)).toEqual({ ok: true, optionIds: ['bar_bat_mitzvah'] })
  })

  it.each([
    'עוד לא החלטנו איזה אירוע',
    'אירוע',
    'שלום',
    'כמה זה עולה?',
    'חתונה או בר מצווה',
    'מבחינה של תאריך עוד לא יודעים',
    'אנחנו מארצות הברית',
    'נכנסתי לאתר שלכם',
  ])('does not guess on %j', (input) => {
    expect(pick(input)).toBeNull()
  })
})

describe('a step without aliases is unchanged', () => {
  const plain: QuestionnaireChoiceStep = {
    ...eventStep,
    options: eventStep.options.map(({ id, label }) => ({ id, label })),
  }
  it.each(['אני מתכנן חתונה', 'יש לנו ברית', 'בר מצווה'])('still refuses %j', (input) => {
    expect(pick(input, plain)).toBeNull()
  })
  it('agency 103 style sample parses and reads only numbers and labels', () => {
    const sample = load('event-photography.he.json')
    const step = sample.steps.find((s) => s.type === 'choice') as QuestionnaireChoiceStep
    expect(step.options.every((o) => o.aliases === undefined)).toBe(true)
    expect(pick('1', step)).toEqual([step.options[0].id])
    expect(pick(`אני רוצה ${step.options[0].label}`, step)).toBeNull()
  })
})

describe('definition validation', () => {
  it('rejects one alias on two options of the same step', () => {
    const bad = JSON.parse(JSON.stringify(pp))
    bad.steps[0].options[1].aliases.push('חתונה')
    const parsed = parseQuestionnaireDefinition(bad)
    expect(parsed.ok).toBe(false)
    if (parsed.ok === false) expect(parsed.errors.join(' ')).toContain("belongs to both 'wedding' and 'bar_bat_mitzvah'")
  })
})

describe('the turn: natural answer advances to the date question', () => {
  const facts = (body: string): TurnFacts => ({
    definition: pp,
    session: {
      id: 1,
      status: 'active',
      currentStepId: 'event_type',
      answers: {},
      invalidCount: 0,
      lastConsumedSequence: 2,
      lastPromptAt: '2026-10-06T09:00:00.000Z',
      version: 0,
    },
    inputs: [{ sequence: 3, kind: 'text', text: body }],
    now: new Date('2026-10-06T09:01:00.000Z'),
    routedToQuestionnaire: true,
    aiState: 'ai_qualifying',
    humanTookOver: false,
    hasPriorOutbound: true,
    leadStatusTerminal: false,
  })

  it.each([
    ['אני מתכנן חתונה', 'wedding'],
    ['בר מצווה', 'bar_bat_mitzvah'],
    ['אני מתכנן בר מצווה', 'bar_bat_mitzvah'],
    ['יש לילדה בת מצווה', 'bar_bat_mitzvah'],
    ['יש לנו אירוע חברה', 'business'],
  ])('%j → Q2, keeping the customer words', (body, option) => {
    const d = decideQuestionnaireTurn(facts(body))
    expect(d).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'event_date', consumeThrough: 3 })
    if (d.kind !== 'question') return
    expect(d.text).toBe('מה תאריך האירוע? אם עוד לא נקבע סופית, אפשר לכתוב תאריך משוער 📅')
    expect(d.answers).toEqual({ event_type: [option], 'event_type:raw': [body] })
  })

  it('an answer by number stores no raw text', () => {
    const d = decideQuestionnaireTurn(facts('1'))
    if (d.kind !== 'question') throw new Error('expected a question')
    expect(d.answers).toEqual({ event_type: ['wedding'] })
  })

  it('an unclear answer re-prompts with the menu, exactly as before', () => {
    const d = decideQuestionnaireTurn(facts('עוד לא החלטנו איזה אירוע'))
    expect(d).toMatchObject({ kind: 'question', reason: 'reprompt_invalid_choice', stepId: 'event_type', invalidCount: 1 })
    if (d.kind === 'question') expect(d.text.startsWith(SYSTEM_LINES.invalidChoice)).toBe(true)
  })

  it('asking for a person still wins over an event word', () => {
    expect(decideQuestionnaireTurn(facts('חתונה, אפשר נציג?'))).toMatchObject({
      kind: 'terminal',
      reason: 'human_request',
      status: 'handed_off',
    })
  })

  it('the rep summary shows the category and the customer words', () => {
    const summary = renderSummary(
      pp,
      { event_type: ['bar_bat_mitzvah'], 'event_type:raw': ['אני מתכנן בר מצווה לבן שלי'], event_date: ['18.12'] },
      { complete: false },
    )
    expect(summary).toContain('סוג האירוע: בר / בת מצווה (אני מתכנן בר מצווה לבן שלי)')
    expect(summary).toContain('תאריך האירוע: 18.12')
  })
})
