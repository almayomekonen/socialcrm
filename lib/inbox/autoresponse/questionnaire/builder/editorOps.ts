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
import { conditionOf, isChoice, keyOf, mapQuestion, newOption, newRef, release, type Condition, type QuestionKind } from './editorBase'

export { keyOf, reactKey, newRef, OTHER_LABEL, optionsOf, conditionOf, dependentsOf, adoptIds } from './editorBase'
export type { Keyed, Condition, Dependents, QuestionKind } from './editorBase'

// ── Questions ────────────────────────────────────────────────────────────────

/** The kinds the "+ הוספת שאלה" menu offers. Free text checks for a real answer by default. */
export type NewQuestionKind = 'single_choice' | 'multi_choice' | 'text'

function blankQuestion(kind: NewQuestionKind, ref: string): BuilderQuestion {
  return {
    ref,
    label: '',
    prompt: '',
    answer: kind === 'text' ? { kind: 'text', notSetAllowed: false } : { kind, options: [newOption(), newOption()] },
    shownWhen: { mode: 'always' },
    messages: {},
  }
}

/** A new question at the end of the conversation (before the ending). */
export function addQuestion(m: BuilderQuestionnaire, kind: NewQuestionKind = 'single_choice', ref: string = newRef()): BuilderQuestionnaire {
  return { ...m, questions: [...m.questions, blankQuestion(kind, ref)] }
}

/**
 * "If the customer chooses X, ask them this too": a question shown only after
 * one answer, placed right after the question it follows (after any follow-ups
 * that answer already has), so it is asked next on that route. The owner never
 * builds the condition; this is the whole of it.
 */
export function addFollowUp(
  m: BuilderQuestionnaire,
  questionKey: string,
  optionKey: string,
  kind: NewQuestionKind = 'text',
  ref: string = newRef(),
): BuilderQuestionnaire {
  const at = m.questions.findIndex((q) => keyOf(q) === questionKey)
  if (at < 0) return m
  let insert = at + 1
  while (insert < m.questions.length) {
    const c = conditionOf(m.questions[insert])
    if (!c || c.questionId !== questionKey || !c.anyOf.includes(optionKey)) break
    insert++
  }
  const question = { ...blankQuestion(kind, ref), shownWhen: { mode: 'all' as const, conditions: [{ questionId: questionKey, anyOf: [optionKey] }] } }
  const questions = [...m.questions]
  questions.splice(insert, 0, question)
  return { ...m, questions }
}

/**
 * "+ הוספת שאלה" on a "continue" arrow of the map (from `after` to `before`):
 * a question asked at exactly that point of the conversation, to exactly the
 * customers who travel that arrow, and to nobody else.
 *
 * The runtime has no "go to": the next question is the next one in order that
 * the customer qualifies for. So the new question is placed, and shares
 * eligibility, like this:
 *   - before a question: immediately before it, with ITS condition (everyone
 *     who reaches it is asked the new one first);
 *   - before the ending: last, with the condition of the question the arrow
 *     leaves (only customers whose conversation ends there are asked).
 * In a questionnaire without conditions that is simply "between the two".
 * `after`/`before` are question keys, or null for the opening/the ending.
 */
export function insertQuestion(
  m: BuilderQuestionnaire,
  arrow: { after: string | null; before: string | null },
  kind: NewQuestionKind = 'single_choice',
  ref: string = newRef(),
): BuilderQuestionnaire {
  const index = arrow.before === null ? m.questions.length : m.questions.findIndex((q) => keyOf(q) === arrow.before)
  if (index < 0) return m
  const like = arrow.before !== null ? m.questions[index] : arrow.after !== null ? m.questions.find((q) => keyOf(q) === arrow.after) : undefined
  const condition = like ? conditionOf(like) : null
  const question = {
    ...blankQuestion(kind, ref),
    ...(condition ? { shownWhen: { mode: 'all' as const, conditions: [{ questionId: condition.questionId, anyOf: [...condition.anyOf] }] } } : {}),
  }
  const questions = [...m.questions]
  questions.splice(index, 0, question)
  return { ...m, questions }
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

/**
 * The short name the נציג reads in the summary, derived from the question:
 * its first line, without emoji or end punctuation, at most 40 characters.
 * The owner can overwrite it; until they do, it follows the question.
 */
export function autoLabel(prompt: string): string {
  const line =
    prompt
      .split('\n')
      .map((l) => l.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').trim())
      .find(Boolean) ?? ''
  const bare = line.replace(/[?!.:,\s]+$/u, '').replace(/\s+/g, ' ')
  if (bare.length <= 40) return bare
  const cut = bare.slice(0, 40)
  return cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : 40).trim()
}

/** Change what the customer sees; a label that was following the question keeps following it. */
export function setPrompt(m: BuilderQuestionnaire, key: string, prompt: string): BuilderQuestionnaire {
  return mapQuestion(m, key, (q) => {
    const following = !q.label.trim() || q.label === autoLabel(q.prompt)
    return { ...q, prompt, ...(following ? { label: autoLabel(prompt) } : {}) }
  })
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

export { addOption, addPhrasing, updateOption, removeOption, otherOf, enableOther, disableOther } from './editorOptions'
export { addEnding, updateEnding, removeEnding, moveEnding } from './editorEndings'
export type { BuilderEnding }
