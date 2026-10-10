import { describe, expect, it } from 'vitest'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { builderQuestionnaireSchema, type BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import {
  MAX_QUESTIONS,
  addFollowUp,
  addQuestion,
  conditionOf,
  enableOther,
  insertQuestion,
  keyOf,
  otherOf,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'

/**
 * Every way the editor adds a question stops at 12, the limit the Builder
 * model and the runtime definition accept. Before this, a follow-up ("+ שאלת
 * המשך") or "אחר" could make a 13th question in the editor, which the save then
 * refused with a generic failure, again on every later edit.
 *
 * The four operations that add a question: addQuestion, insertQuestion,
 * addFollowUp, enableOther. Nothing else in editorOps/editorOptions/
 * editorEndings grows `questions`.
 */

const base = { schemaVersion: 1, revision: 1, language: 'he', welcome: 'היי', closing: 'תודה', handoff: 'נציג', summaryTitle: 'סיכום', expireAfterHours: 24, maxInvalidAttempts: 2 }
const text = (id: string) => ({ id, type: 'text', label: id, prompt: `${id}?`, validate: 'meaningful' })

/** A choice question first, then text questions, `count` in all. */
function questionnaire(count: number, labels = ['תספורת', 'צבע']): BuilderQuestionnaire {
  const choice = { id: 'q_kind', type: 'choice', label: 'סוג', prompt: 'במה נוכל לעזור?', options: labels.map((label, i) => ({ id: `o_${i}`, label })) }
  return toBuilder({ ...base, steps: [choice, ...Array.from({ length: count - 1 }, (_, i) => text(`q_${i + 2}`))] } as never)
}
const saves = (m: BuilderQuestionnaire) => builderQuestionnaireSchema.safeParse(m).success

describe('the limit', () => {
  it('is the same 12 the Builder model accepts', () => {
    expect(MAX_QUESTIONS).toBe(12)
    expect(saves(questionnaire(12))).toBe(true)
    expect(saves({ ...questionnaire(12), questions: [...questionnaire(12).questions, questionnaire(2).questions[1]] })).toBe(false)
  })
})

describe('at 12 questions, nothing adds a 13th, and the draft is the same object (so nothing is saved)', () => {
  const full = questionnaire(12)

  it('"הוספת שאלה" (addQuestion)', () => {
    expect(addQuestion(full, 'text', 'new_x')).toBe(full)
  })

  it('"+ הוספת שאלה" on an arrow (insertQuestion), between questions and before the ending', () => {
    expect(insertQuestion(full, { after: 'q_kind', before: 'q_2' }, 'text', 'new_x')).toBe(full)
    expect(insertQuestion(full, { after: 'q_12', before: null }, 'text', 'new_x')).toBe(full)
  })

  it('"+ שאלת המשך אם בוחרים בזה" (addFollowUp)', () => {
    expect(addFollowUp(full, 'q_kind', 'o_0', 'text', 'new_x')).toBe(full)
  })

  it('turning on "אחר" (enableOther): neither the option nor its follow-up is added', () => {
    expect(enableOther(full, 'q_kind')).toBe(full)
  })

  it('"הוספת שאלת המשך" for an "אחר" that has none yet (enableOther)', () => {
    const withOther = questionnaire(12, ['תספורת', 'צבע', 'אחר'])
    expect(otherOf(withOther, 'q_kind')?.followUp).toBeNull()
    expect(enableOther(withOther, 'q_kind')).toBe(withOther)
  })
})

describe('at 11 questions, each way still reaches 12, valid and savable, with order and conditions as before', () => {
  const eleven = questionnaire(11)

  it('a follow-up: right after its question, shown only after that answer', () => {
    const m = addFollowUp(eleven, 'q_kind', 'o_0', 'text', 'new_x')
    expect(m.questions).toHaveLength(12)
    expect(m.questions.map(keyOf)).toEqual(['q_kind', 'new_x', ...eleven.questions.slice(1).map(keyOf)])
    expect(conditionOf(m.questions[1])).toEqual({ questionId: 'q_kind', anyOf: ['o_0'] })
    expect(saves(m)).toBe(true)
    expect(previewDefinition(m)?.steps).toHaveLength(12)
  })

  it('"אחר": the option and its follow-up', () => {
    const m = enableOther(eleven, 'q_kind')
    expect(m.questions).toHaveLength(12)
    const other = otherOf(m, 'q_kind')
    expect(other?.option.label).toBe('אחר')
    expect(other?.followUp && conditionOf(other.followUp)).toEqual({ questionId: 'q_kind', anyOf: [keyOf(other!.option)] })
    expect(saves(m)).toBe(true)
  })

  it('a question at the end, or on an arrow', () => {
    expect(addQuestion(eleven, 'text', 'new_x').questions).toHaveLength(12)
    expect(insertQuestion(eleven, { after: 'q_kind', before: 'q_2' }, 'text', 'new_x').questions.map(keyOf).slice(0, 3)).toEqual(['q_kind', 'new_x', 'q_2'])
  })
})
