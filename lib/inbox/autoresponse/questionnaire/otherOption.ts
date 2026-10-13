/**
 * "אחר" as the engine sees it: an ordinary option, plus the ordinary free-text
 * question the Builder asks after it (builder/editorOptions.ts `otherOf`).
 * Not a new primitive; the same label rule the Builder and its publish check
 * use, defined once here.
 */
import { rawAnswerKey } from './answerKeys'
import {
  nextStepAfter,
  type QuestionnaireChoiceStep,
  type QuestionnaireDefinition,
  type QuestionnaireOption,
  type QuestionnaireStep,
} from './definition'

/** "אחר" as a word of its own. */
export const OTHER_LABEL = /(^|\s)אחר(\s|$)/

export function otherOptionOf(step: QuestionnaireChoiceStep): QuestionnaireOption | null {
  return step.options.find((o) => OTHER_LABEL.test(o.label.trim())) ?? null
}

/** The free-text question shown only to whoever chose this "אחר", if there is one. */
export function otherFollowUpOf(
  definition: QuestionnaireDefinition,
  stepId: string,
  otherId: string,
): QuestionnaireStep | null {
  return (
    definition.steps.find(
      (s) => s.type === 'text' && s.when?.step === stepId && s.when.anyOf.length === 1 && s.when.anyOf[0] === otherId,
    ) ?? null
  )
}

/**
 * The customer already said what their "אחר" is ("צילום אירועים"): that is the
 * follow-up's answer, so it is not asked again. Only when the words chose
 * "אחר" (a raw answer exists); a typed number still gets the follow-up.
 */
export function preAnswerOtherFollowUp(
  definition: QuestionnaireDefinition,
  step: QuestionnaireStep,
  answer: Record<string, string[]>,
): Record<string, string[]> {
  if (step.type !== 'choice') return answer
  const other = otherOptionOf(step)
  const raw = answer[rawAnswerKey(step.id)]?.[0]
  if (!other || !raw || !(answer[step.id] ?? []).includes(other.id)) return answer
  const followUp = otherFollowUpOf(definition, step.id, other.id)
  return followUp ? { ...answer, [followUp.id]: [raw] } : answer
}

/** nextStepAfter, past any step whose answer is already there. */
export function nextUnansweredStep(
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
  afterStepId: string,
): QuestionnaireStep | null {
  let next = nextStepAfter(definition, answers, afterStepId)
  while (next && (answers[next.id]?.length ?? 0) > 0) next = nextStepAfter(definition, answers, next.id)
  return next
}
