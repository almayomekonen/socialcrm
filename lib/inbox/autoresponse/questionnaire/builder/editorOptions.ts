/**
 * Answer options, their natural phrasings, and "אחר" with its follow-up.
 *
 * "אחר" IS NOT A NEW PRIMITIVE. It is an ordinary option plus an ordinary free
 * text question shown only after it, exactly what Perfect Picture's
 * "אירוע אחר" → "איזה אירוע אתם מתכננים?" already is. The owner flips one
 * switch; the editor builds that pair, and recognises an existing pair when it
 * loads one, so the runtime sees nothing it has not always run.
 */
import type { BuilderOption, BuilderQuestion, BuilderQuestionnaire } from './model'
import { OTHER_LABEL, conditionOf, isChoice, keyOf, mapQuestion, newOption, newRef, optionsOf, release } from './editorBase'

export function addOption(m: BuilderQuestionnaire, questionKey: string): BuilderQuestionnaire {
  return mapQuestion(m, questionKey, (q) => {
    if (!isChoice(q.answer)) return q
    // A new option goes above "אחר", which reads best last.
    const options = [...q.answer.options]
    const other = options.findIndex((o) => OTHER_LABEL.test(o.label))
    options.splice(other < 0 ? options.length : other, 0, newOption())
    return { ...q, answer: { ...q.answer, options } }
  })
}

export function updateOption(
  m: BuilderQuestionnaire,
  questionKey: string,
  optionKey: string,
  patch: Partial<Pick<BuilderOption, 'label' | 'icon' | 'phrasings'>>,
): BuilderQuestionnaire {
  return mapQuestion(m, questionKey, (q) => {
    if (!isChoice(q.answer)) return q
    const options = q.answer.options.map((o) => {
      if (keyOf(o) !== optionKey) return o
      const next = { ...o, ...patch }
      // An emptied icon is no icon, not an empty one.
      if (next.icon !== undefined && !next.icon.trim()) delete next.icon
      return next
    })
    return { ...q, answer: { ...q.answer, options } }
  })
}

export function removeOption(m: BuilderQuestionnaire, questionKey: string, optionKey: string): BuilderQuestionnaire {
  const released = release(m, questionKey, [optionKey])
  return mapQuestion(released, questionKey, (q) =>
    isChoice(q.answer) ? { ...q, answer: { ...q.answer, options: q.answer.options.filter((o) => keyOf(o) !== optionKey) } } : q,
  )
}

/** The "אחר" option of a question, and the free-text question asked after it, if any. */
export function otherOf(
  m: BuilderQuestionnaire,
  questionKey: string,
): { option: BuilderOption; followUp: BuilderQuestion | null } | null {
  const question = m.questions.find((q) => keyOf(q) === questionKey)
  if (!question) return null
  const option = optionsOf(question).find((o) => OTHER_LABEL.test(o.label))
  if (!option) return null
  const followUp =
    m.questions.find((q) => {
      const c = conditionOf(q)
      const textual = q.answer.kind === 'text' || q.answer.kind === 'text_unchecked'
      return textual && c?.questionId === questionKey && c.anyOf.length === 1 && c.anyOf[0] === keyOf(option)
    }) ?? null
  return { option, followUp }
}

/**
 * Turn on "אפשר ללקוח לבחור 'אחר'": the option (last), and its follow-up right
 * after the question. An existing "אחר" without a follow-up gets one.
 */
export function enableOther(m: BuilderQuestionnaire, questionKey: string): BuilderQuestionnaire {
  const index = m.questions.findIndex((q) => keyOf(q) === questionKey)
  const question = m.questions[index]
  if (!question || !isChoice(question.answer)) return m
  const existing = otherOf(m, questionKey)
  if (existing?.followUp) return m

  let next = m
  let optionKey = existing ? keyOf(existing.option) : ''
  if (!existing) {
    const option: BuilderOption = { ref: newRef(), label: 'אחר', phrasings: ['משהו אחר'] }
    optionKey = option.ref as string
    next = mapQuestion(m, questionKey, (q) =>
      isChoice(q.answer) ? { ...q, answer: { ...q.answer, options: [...q.answer.options, option] } } : q,
    )
  }
  const followUp: BuilderQuestion = {
    ref: newRef(),
    label: `פירוט: ${question.label || 'אחר'}`.slice(0, 40),
    prompt: 'בשמחה, ספרו לנו בקצרה במה מדובר.',
    answer: { kind: 'text', notSetAllowed: false },
    shownWhen: { mode: 'all', conditions: [{ questionId: questionKey, anyOf: [optionKey] }] },
    messages: {},
  }
  const questions = [...next.questions]
  questions.splice(index + 1, 0, followUp)
  return { ...next, questions }
}

/** Turn it off: the option goes, and so does the follow-up the editor recognises as its own. */
export function disableOther(m: BuilderQuestionnaire, questionKey: string): BuilderQuestionnaire {
  const other = otherOf(m, questionKey)
  if (!other) return m
  const withoutFollowUp = other.followUp ? { ...m, questions: m.questions.filter((q) => q !== other.followUp) } : m
  const optionKey = keyOf(other.option)
  const released = release(withoutFollowUp, questionKey, [optionKey])
  return mapQuestion(released, questionKey, (q) =>
    isChoice(q.answer) ? { ...q, answer: { ...q.answer, options: q.answer.options.filter((o) => keyOf(o) !== optionKey) } } : q,
  )
}

/** Teach an answer one more way customers write it (no duplicates; an empty phrase is ignored). */
export function addPhrasing(m: BuilderQuestionnaire, questionKey: string, optionKey: string, phrase: string): BuilderQuestionnaire {
  const value = phrase.trim()
  if (!value) return m
  return mapQuestion(m, questionKey, (q) => {
    if (!isChoice(q.answer)) return q
    const options = q.answer.options.map((o) =>
      keyOf(o) === optionKey && !o.phrasings.includes(value) ? { ...o, phrasings: [...o.phrasings, value] } : o,
    )
    return { ...q, answer: { ...q.answer, options } }
  })
}
