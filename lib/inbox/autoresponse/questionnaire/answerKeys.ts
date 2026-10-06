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
