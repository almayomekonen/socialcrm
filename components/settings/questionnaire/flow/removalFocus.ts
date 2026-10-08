/**
 * Where the cursor goes after a question is deleted from the map, so it never
 * falls to the page: a follow-up returns to the question it followed; any
 * other question to the nearest question before it that still exists, else
 * the nearest after it; with no question left, "+ הוספת שאלה". Only questions
 * that survive the deletion are chosen.
 * Pure: the model before the deletion in, a render key (or 'add') out.
 */
import { conditionOf, keyOf, reactKey, removeQuestion } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

export const ADD_QUESTION = 'add'

export function focusAfterRemoval(m: BuilderQuestionnaire, key: string): string {
  const index = m.questions.findIndex((q) => keyOf(q) === key)
  if (index < 0) return ADD_QUESTION
  const survivors = new Set(removeQuestion(m, key).questions.map(keyOf))
  const alive = (k: string | undefined) => (k && survivors.has(k) ? m.questions.find((q) => keyOf(q) === k) : undefined)
  const source = alive(conditionOf(m.questions[index])?.questionId)
  const before = m.questions.slice(0, index).reverse().find((q) => survivors.has(keyOf(q)))
  const after = m.questions.slice(index + 1).find((q) => survivors.has(keyOf(q)))
  const target = source ?? before ?? after
  return target ? reactKey(target) : ADD_QUESTION
}
