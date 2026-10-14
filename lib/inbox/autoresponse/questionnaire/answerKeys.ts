/**
 * The two extra keys a step's answer may carry beside `answers[stepId]`. A step
 * id cannot contain ':', so neither can ever be mistaken for a step.
 */

/**
 * Where a choice answer read from natural words (aliasMatch.ts) keeps those
 * words, beside the option id: `answers["timing:raw"] = ["רק בערב אחרי העבודה"]`.
 * A step id cannot contain ':', so this key can never be mistaken for a step.
 */
export function rawAnswerKey(stepId: string): string {
  return `${stepId}:raw`
}

/**
 * A text answer's meaning when it is not just the words: `["not_set"]` when the
 * customer said the date is not decided yet (validateAnswer.ts). The words
 * themselves stay in `answers[stepId]`.
 */
export function answerStateKey(stepId: string): string {
  return `${stepId}:state`
}

/**
 * Not a step's answer: what the customer wrote to correct an EARLIER answer
 * ("טעיתי 19.11") while a later question was open. The engine cannot edit a
 * past answer, so the words are kept here and shown to the rep.
 */
export const CORRECTIONS_KEY = ':corrections'

/** Questions the customer asked us instead of answering; a rep answers them. */
export const QUESTIONS_KEY = ':questions'

/**
 * Messages that said something but answered no open question: sent together
 * with an answer, or before the question was asked. Kept for the rep, never
 * guessed into a field.
 */
export const UNPLACED_KEY = ':unplaced'

/**
 * Words about THIS question that answered none of its options: a long
 * description, an "all" the question does not accept, the words of a handoff
 * message. Kept against the question so the rep reads them in context
 * (stepNotes.ts). Never written by an answer, so a later selection cannot
 * overwrite it.
 */
export function noteKey(stepId: string): string {
  return `${stepId}:note`
}
