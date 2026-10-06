/**
 * Every character the customer and the נציג ever see from the questionnaire.
 *
 * Pure string assembly from the business's own definition plus a small set of
 * fixed system lines. There is no generation here and no branching on anything
 * but the definition, so the same conversation always produces the same words.
 *
 * The system lines are Hebrew, short, and never promise anything the product
 * cannot keep: no callback time, no "someone will call you in X minutes". What
 * the business promises is its own `closing` text, which it wrote.
 */
import {
  answerStateKey,
  CORRECTIONS_KEY,
  rawAnswerKey,
  type QuestionnaireDefinition,
  type QuestionnaireOption,
  type QuestionnaireStep,
} from './definition'

/** Shown under every menu so asking for a person never requires guessing. */
export const HUMAN_HINT = 'לשיחה עם נציג כתבו: נציג'

export const SYSTEM_LINES = {
  invalidChoice: 'לא זיהינו את הבחירה.',
  invalidMulti: 'אפשר לבחור מספר אחד בלבד.',
  invalidText: 'לא הצלחנו לקרוא את התשובה.',
  mediaOnly: 'כרגע אפשר להשיב כאן בהודעת טקסט בלבד.',
  voiceOnly: 'אין באפשרותנו להאזין להודעות קוליות.',
  restarted: 'מתחילים מחדש.',
} as const

export function renderStep(step: QuestionnaireStep): string {
  if (step.type === 'text') return step.prompt
  const lines = [step.prompt]
  if (step.multi === true) lines.push('אפשר לבחור יותר מאחד, למשל: 1,3')
  lines.push('')
  step.options.forEach((option, index) => {
    lines.push(menuLine(option, index))
  })
  return lines.join('\n')
}

/** How the rep reads an answer whose state is `not_set` (validateAnswer.ts). */
export const NOT_SET_SUMMARY = 'טרם נקבע'
/** How the rep reads a correction the engine could not apply to an earlier answer. */
export const CORRECTION_LABEL = 'תיקון מהלקוח'

/** One numbered menu line. The icon, when there is one, is decoration after the label. */
export function menuLine(option: QuestionnaireOption, index: number): string {
  return option.icon ? `${index + 1}. ${option.label} ${option.icon}` : `${index + 1}. ${option.label}`
}

/** First message of a conversation: the welcome and the first question together. */
export function renderOpening(definition: QuestionnaireDefinition, step: QuestionnaireStep): string {
  return [definition.welcome, '', renderStep(step), '', HUMAN_HINT].join('\n')
}

export function renderQuestion(step: QuestionnaireStep): string {
  return step.type === 'choice' ? [renderStep(step), '', HUMAN_HINT].join('\n') : renderStep(step)
}

export type RepromptReason = 'invalid_choice' | 'invalid_multi' | 'invalid_text' | 'media' | 'voice'

const REPROMPT_LINE: Record<RepromptReason, string> = {
  invalid_choice: SYSTEM_LINES.invalidChoice,
  invalid_multi: SYSTEM_LINES.invalidMulti,
  invalid_text: SYSTEM_LINES.invalidText,
  media: SYSTEM_LINES.mediaOnly,
  voice: SYSTEM_LINES.voiceOnly,
}

export function renderReprompt(step: QuestionnaireStep, reason: RepromptReason): string {
  // A question with its own re-ask says exactly that, and nothing it already
  // said once (a greeting in its prompt is not repeated).
  if (reason === 'invalid_text' && step.type === 'text' && step.invalidPrompt) return step.invalidPrompt
  return [REPROMPT_LINE[reason], '', renderQuestion(step)].join('\n')
}

export function renderRestart(definition: QuestionnaireDefinition, step: QuestionnaireStep): string {
  return [SYSTEM_LINES.restarted, '', renderQuestion(step)].join('\n')
}

/**
 * The answers as the rep reads them. A fixed template: one line per answered
 * question, labelled by the definition, in the order they were asked. A
 * question the customer never reached is omitted rather than shown empty,
 * because a blank line reads as "they refused to say" when the truth is "we
 * never asked".
 */
export function renderSummary(
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
  opts: { complete: boolean },
): string {
  const lines: string[] = [opts.complete ? definition.summaryTitle : `${definition.summaryTitle} (לא הושלם)`]
  for (const step of definition.steps) {
    const value = summaryValue(step, answers[step.id], answers[rawAnswerKey(step.id)], answers[answerStateKey(step.id)])
    if (value) lines.push(`${step.label}: ${value}`)
  }
  for (const said of answers[CORRECTIONS_KEY] ?? []) lines.push(`${CORRECTION_LABEL}: ${said}`)
  return lines.join('\n')
}

/** Structured rows for the inbox banner: the same data, unformatted. */
export function summaryFields(
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = []
  for (const step of definition.steps) {
    const value = summaryValue(step, answers[step.id], answers[rawAnswerKey(step.id)], answers[answerStateKey(step.id)])
    if (value) fields.push({ label: step.label, value })
  }
  for (const said of answers[CORRECTIONS_KEY] ?? []) fields.push({ label: CORRECTION_LABEL, value: said })
  return fields
}

function summaryValue(
  step: QuestionnaireStep,
  stored: string[] | undefined,
  raw?: string[],
  state?: string[],
): string | null {
  if (!stored || !stored.length) return null
  // Said plainly, never as the customer's phrasing of "we don't know yet".
  if (state?.[0] === 'not_set') return NOT_SET_SUMMARY
  if (step.type === 'text') return stored[0]?.trim() || null
  const labels = stored
    .map((id) => step.options.find((o) => o.id === id)?.label)
    .filter((l): l is string => Boolean(l))
  if (!labels.length) return null
  // An answer read from natural words shows those words too, so the rep sees
  // "ערב (רק בערב אחרי העבודה)" rather than only the option.
  const said = raw?.[0]?.trim()
  return said ? `${labels.join(', ')} (${said})` : labels.join(', ')
}
