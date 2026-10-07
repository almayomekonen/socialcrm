/**
 * Every change the conversation editor can make, as pure functions over the
 * Builder model. The UI calls these and renders the result; it never reshapes
 * the model itself.
 *
 * Identity: an entity the server has seen has an `id`; a new one has a `ref`
 * (model.ts) until the next save returns its id. `keyOf` is the one name the
 * editor uses for either.
 *
 * Deleting something other parts depend on never leaves a dangling reference:
 * a question shown only after a deleted answer becomes "always shown", and a
 * custom ending that depended on it is removed. `dependentsOf` lets the UI say
 * so before it happens.
 */
import type { AnswerSpec, BuilderEnding, BuilderQuestion, BuilderQuestionnaire } from './model'
import { isChoice, keyOf, mapQuestion, newOption, newRef, release, type Condition, type QuestionKind } from './editorBase'

export { keyOf, newRef, OTHER_LABEL, optionsOf, conditionOf, dependentsOf, adoptIds } from './editorBase'
export type { Keyed, Condition, Dependents, QuestionKind } from './editorBase'

// ── Questions ────────────────────────────────────────────────────────────────

export function addQuestion(m: BuilderQuestionnaire): BuilderQuestionnaire {
  const question: BuilderQuestion = {
    ref: newRef(),
    label: '',
    prompt: '',
    answer: { kind: 'single_choice', options: [newOption(), newOption()] },
    shownWhen: { mode: 'always' },
    messages: {},
  }
  return { ...m, questions: [...m.questions, question] }
}

export function removeQuestion(m: BuilderQuestionnaire, key: string): BuilderQuestionnaire {
  const released = release(m, key)
  return { ...released, questions: released.questions.filter((q) => keyOf(q) !== key) }
}

export function moveQuestion(m: BuilderQuestionnaire, key: string, by: -1 | 1): BuilderQuestionnaire {
  const from = m.questions.findIndex((q) => keyOf(q) === key)
  const to = from + by
  if (from < 0 || to < 0 || to >= m.questions.length) return m
  const questions = [...m.questions]
  ;[questions[from], questions[to]] = [questions[to], questions[from]]
  return { ...m, questions }
}

export function updateQuestion(
  m: BuilderQuestionnaire,
  key: string,
  patch: Partial<Pick<BuilderQuestion, 'label' | 'prompt' | 'messages'>>,
): BuilderQuestionnaire {
  return mapQuestion(m, key, (q) => ({ ...q, ...patch }))
}

/**
 * Change how the customer answers. Choice ⇄ choice keeps the options; leaving
 * choice drops them and releases whatever depended on them; the not-understood
 * messages exist only for free text.
 */
export function setAnswerKind(m: BuilderQuestionnaire, key: string, kind: QuestionKind): BuilderQuestionnaire {
  const current = m.questions.find((q) => keyOf(q) === key)
  if (!current || current.answer.kind === kind) return m
  const wasChoice = isChoice(current.answer)
  const toChoice = kind === 'single_choice' || kind === 'multi_choice'
  const base = wasChoice && !toChoice ? release(m, key) : m
  return mapQuestion(base, key, (q) => {
    if (toChoice) {
      const options = isChoice(q.answer) ? q.answer.options : [newOption(), newOption()]
      return { ...q, answer: { kind, options }, messages: {} }
    }
    const notSetAllowed = 'notSetAllowed' in q.answer ? q.answer.notSetAllowed : kind === 'date'
    const answer: AnswerSpec = kind === 'text_unchecked' ? { kind } : { kind, notSetAllowed }
    return { ...q, answer }
  })
}

export function setNotSetAllowed(m: BuilderQuestionnaire, key: string, allowed: boolean): BuilderQuestionnaire {
  return mapQuestion(m, key, (q) =>
    q.answer.kind === 'text' || q.answer.kind === 'date' ? { ...q, answer: { ...q.answer, notSetAllowed: allowed } } : q,
  )
}

export function setShownWhen(m: BuilderQuestionnaire, key: string, condition: Condition | null): BuilderQuestionnaire {
  return mapQuestion(m, key, (q) => ({
    ...q,
    shownWhen: condition ? { mode: 'all', conditions: [condition] } : { mode: 'always' },
  }))
}

/** Questions a condition on question `key` may depend on: earlier choice questions. */
export function conditionSources(m: BuilderQuestionnaire, key: string): BuilderQuestion[] {
  const index = m.questions.findIndex((q) => keyOf(q) === key)
  return m.questions.slice(0, index < 0 ? m.questions.length : index).filter((q) => isChoice(q.answer))
}

export { addOption, updateOption, removeOption, otherOf, enableOther, disableOther } from './editorOptions'
export { addEnding, updateEnding, removeEnding, moveEnding } from './editorEndings'
export type { BuilderEnding }
