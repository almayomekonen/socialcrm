import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { emptyQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
import { buildFlow, ENDINGS, OPENING } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import {
  addFollowUp,
  addQuestion,
  conditionOf,
  keyOf,
  optionsOf,
  setPrompt,
  updateOption,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

/**
 * The Flow view's map, derived from the draft through the runtime's own route
 * logic. Every arrow must be a turn a customer can take, and nothing about the
 * map may be stored in the definition.
 */

const load = (file: string): QuestionnaireDefinition => {
  const parsed = parseQuestionnaireDefinition(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'))
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}
const pp = load('perfect-picture.he.json')
const pilot = load('socialcrm-pilot.he.json')

const arrows = (m: BuilderQuestionnaire) => buildFlow(m).edges.map((e) => `${e.source}${e.option ? `[${e.option}]` : ''}→${e.target}`).sort()

/** The salon from the brief: service (3 answers) → preferred date → ending. */
function salon(): BuilderQuestionnaire {
  let m = toBuilder(emptyQuestionnaire('סלון דנה'))
  const service = keyOf(m.questions[0])
  m = setPrompt(m, service, 'איזה שירות מעניין אותך?')
  const [a, b] = optionsOf(m.questions[0]).map(keyOf)
  m = updateOption(m, service, a, { label: 'איפור', icon: '💄' })
  m = updateOption(m, service, b, { label: 'שיער', icon: '💇' })
  m = addQuestion(m, 'text', 'new_date000001')
  m = setPrompt(m, 'new_date000001', 'איזה תאריך נוח לך?')
  return m
}

describe('the flow map', () => {
  it('a linear questionnaire is one line: opening → questions → endings, no answer arrows', () => {
    expect(arrows(salon())).toEqual(['opening→request_type', 'request_type→new_date000001', `new_date000001→${ENDINGS}`].sort())
  })

  it('"+ שאלת המשך" on one answer: that answer gets its own arrow, the rest continue as before', () => {
    const m = addFollowUp(salon(), 'request_type', 'option_1', 'text', 'new_follow0001')
    const follow = m.questions.find((q) => q.ref === 'new_follow0001')!
    expect(m.questions.map(keyOf)).toEqual(['request_type', 'new_follow0001', 'new_date000001'])
    expect(conditionOf(follow)).toEqual({ questionId: 'request_type', anyOf: ['option_1'] })
    expect(arrows(m)).toEqual([
      'opening→request_type',
      'request_type→new_date000001',
      'request_type[option_1]→new_follow0001',
      'new_follow0001→new_date000001',
      `new_date000001→${ENDINGS}`,
    ].sort())
  })

  it('a second follow-up for the same answer is asked after the first', () => {
    let m = addFollowUp(salon(), 'request_type', 'option_1', 'text', 'new_follow0001')
    m = addFollowUp(m, 'request_type', 'option_1', 'text', 'new_follow0002')
    expect(m.questions.map(keyOf)).toEqual(['request_type', 'new_follow0001', 'new_follow0002', 'new_date000001'])
  })

  it('every arrow is a turn the simulator (production decision code) actually takes', () => {
    const m = addFollowUp(salon(), 'request_type', 'option_1', 'text', 'new_follow0001')
    const m2 = setPrompt(m, 'new_follow0001', 'לאיזה אירוע האיפור?')
    const def = previewDefinition(m2)!
    const makeup = simulateConversation(def, [['היי'], ['1'], ['חתונה']])
    expect(makeup.turns[1].explanation.nextQuestionId).toBe('new_follow0001')
    expect(makeup.turns[2].explanation.nextQuestionId).toBe('new_date000001')
    const hair = simulateConversation(def, [['היי'], ['2']])
    expect(hair.turns[1].explanation.nextQuestionId).toBe('new_date000001')
  })

  it('the map is presentation: nothing about it is in the stored definition', () => {
    const def = previewDefinition(addFollowUp(salon(), 'request_type', 'option_1'))!
    expect(JSON.stringify(def)).not.toMatch(/position|layout|"x"|"y"/)
  })
})

describe('Perfect Picture (agency 158 revision 4) as a map', () => {
  const g = buildFlow(toBuilder(pp))
  const from = (q: string) => g.edges.filter((e) => e.source === q).map((e) => `${e.option ?? '*'}→${e.target}`).sort()

  it('every question is reachable and in runtime order', () => {
    expect(g.unreachable).toEqual([])
    expect(g.questions).toEqual(pp.steps.map((s) => s.id))
  })

  it('the event question shows its routes: celebrations, business, other, drone', () => {
    expect(from('event_type')).toEqual(
      ['*→event_date_celebration', 'business→event_date', 'drone→drone_city', 'other→event_other'].sort(),
    )
  })

  it('routes merge back into the shared questions instead of duplicating them', () => {
    expect(from('event_other')).toEqual(['*→event_date'])
    expect(from('event_date')).toEqual(['*→event_location'])
    expect(from('event_date_celebration')).toEqual(['*→event_location'])
    expect(from('event_location')).toEqual(['*→service'])
    expect(from('service')).toEqual([`*→${ENDINGS}`, 'other→service_other'])
    expect(from('drone_date')).toEqual([`*→${ENDINGS}`])
  })

  it('stays small: one arrow per distinct turn', () => {
    expect(g.edges.length).toBeLessThanOrEqual(16)
    expect(g.edges.filter((e) => e.source === OPENING)).toEqual([{ id: 'opening->event_type', source: OPENING, target: 'event_type' }])
  })
})

describe('agency 103 as a map', () => {
  it('is a straight line of six questions', () => {
    const g = buildFlow(toBuilder(pilot))
    expect(g.edges.every((e) => !e.option)).toBe(true)
    expect(g.edges).toHaveLength(7)
  })
})
