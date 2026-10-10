import { describe, expect, it } from 'vitest'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { insertQuestion, keyOf, setPrompt } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { nextStepAfter } from '@/lib/inbox/autoresponse/questionnaire/definition'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

/**
 * "+ הוספת שאלה" on a continue arrow: the new question is asked at that point,
 * to the customers on that arrow, and the runtime's own routing (nextStepAfter)
 * shows nobody else's conversation changes.
 */

const base = {
  schemaVersion: 1,
  revision: 1,
  language: 'he',
  welcome: 'היי',
  closing: 'תודה',
  handoff: 'מעבירים לנציג',
  summaryTitle: 'סיכום',
  expireAfterHours: 24,
  maxInvalidAttempts: 2,
}
const text = (id: string, when?: { step: string; anyOf: string[] }) => ({ id, type: 'text', label: id, prompt: `${id}?`, validate: 'meaningful', ...(when ? { when } : {}) })

/** Two plain questions, no conditions. */
const linear = () => toBuilder({ ...base, steps: [text('q_a'), text('q_b')] } as never)
/** Agency 103's shape: a main path for two answers, a follow-up each for the other two, all ending. */
const branching = () =>
  toBuilder({
    ...base,
    steps: [
      { id: 'q_kind', type: 'choice', label: 'סוג', prompt: 'במה נוכל לעזור?', options: [
        { id: 'o_learn', label: 'להכיר' }, { id: 'o_price', label: 'מחיר' }, { id: 'o_help', label: 'עזרה' }, { id: 'o_other', label: 'אחר' },
      ] },
      text('q_other', { step: 'q_kind', anyOf: ['o_other'] }),
      text('q_field', { step: 'q_kind', anyOf: ['o_learn', 'o_price'] }),
      text('q_team', { step: 'q_kind', anyOf: ['o_learn', 'o_price'] }),
      text('q_help', { step: 'q_kind', anyOf: ['o_help'] }),
    ],
  } as never)

/** The questions a customer is asked, in order, by the runtime (choice answers given by option id). */
function route(m: BuilderQuestionnaire, choices: Record<string, string> = {}): string[] {
  const def = previewDefinition(m)!
  const answers: Record<string, string[]> = {}
  const asked: string[] = []
  let step = nextStepAfter(def, answers, null)
  while (step) {
    asked.push(step.id)
    answers[step.id] = [step.type === 'choice' ? choices[step.id] ?? step.options[0].id : 'answer']
    step = nextStepAfter(def, answers, step.id)
  }
  return asked
}
const insert = (m: BuilderQuestionnaire, after: string | null, before: string | null) =>
  setPrompt(insertQuestion(m, { after, before }, 'text', 'new_q'), 'new_q', 'שאלה חדשה?')

describe('inserting a question on a continue arrow', () => {
  it('between two questions: asked between them', () => {
    const m = insert(linear(), 'q_a', 'q_b')
    expect(m.questions.map(keyOf)).toEqual(['q_a', 'new_q', 'q_b'])
    expect(route(m)).toEqual(['q_a', 'new_q', 'q_b'])
  })

  it('on the arrow into the ending: asked last, immediately before the ending', () => {
    const m = insert(linear(), 'q_b', null)
    expect(m.questions.map(keyOf)).toEqual(['q_a', 'q_b', 'new_q'])
    expect(route(m)).toEqual(['q_a', 'q_b', 'new_q'])
  })

  it('on the arrow from the opening: becomes the first question', () => {
    const m = insert(linear(), null, 'q_a')
    expect(route(m)).toEqual(['new_q', 'q_a', 'q_b'])
  })

  it('the first question of an empty questionnaire (opening → ending)', () => {
    const empty = toBuilder({ ...base, steps: [] } as never)
    const m = insert(empty, null, null)
    expect(m.questions.map(keyOf)).toEqual(['new_q'])
    expect(route(m)).toEqual(['new_q'])
  })

  it('creates exactly one question and nothing else changes', () => {
    const before = linear()
    const m = insertQuestion(before, { after: 'q_a', before: 'q_b' }, 'single_choice', 'new_q')
    expect(m.questions).toHaveLength(before.questions.length + 1)
    expect(m.questions.filter((q) => keyOf(q) !== 'new_q')).toEqual(before.questions)
    expect(m.questions[1].answer.kind).toBe('single_choice')
  })

  it("on a branch's arrow: only the customers on that arrow are asked; every other route is unchanged", () => {
    const m0 = branching()
    // The main path's arrow q_kind → q_field (travelled by "להכיר" and "מחיר").
    const m = insert(m0, 'q_kind', 'q_field')
    expect(m.questions.map(keyOf)).toEqual(['q_kind', 'q_other', 'new_q', 'q_field', 'q_team', 'q_help'])
    expect(route(m, { q_kind: 'o_learn' })).toEqual(['q_kind', 'new_q', 'q_field', 'q_team'])
    expect(route(m, { q_kind: 'o_price' })).toEqual(['q_kind', 'new_q', 'q_field', 'q_team'])
    expect(route(m, { q_kind: 'o_help' })).toEqual(route(m0, { q_kind: 'o_help' }))
    expect(route(m, { q_kind: 'o_other' })).toEqual(route(m0, { q_kind: 'o_other' }))
  })

  it("on a follow-up's arrow into the ending: asked last, to that follow-up's customers only", () => {
    const m0 = branching()
    const m = insert(m0, 'q_help', null)
    expect(route(m, { q_kind: 'o_help' })).toEqual(['q_kind', 'q_help', 'new_q'])
    for (const o of ['o_learn', 'o_price', 'o_other']) expect(route(m, { q_kind: o })).toEqual(route(m0, { q_kind: o }))
  })

  it('an arrow to a question that no longer exists changes nothing', () => {
    const m0 = linear()
    expect(insertQuestion(m0, { after: 'q_a', before: 'gone' }, 'text', 'new_q')).toBe(m0)
  })
})
