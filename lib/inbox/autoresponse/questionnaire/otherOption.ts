/**
 * "אחר" as the engine sees it: an ordinary option, plus the ordinary free-text
 * question the Builder asks after it (builder/editorOptions.ts `otherOf`).
 * Not a new primitive; the same label rule the Builder and its publish check
 * use, defined once here.
 */
import {
  nextStepAfter,
  type QuestionnaireChoiceStep,
  type QuestionnaireDefinition,
  type QuestionnaireOption,
  type QuestionnaireStep,
} from './definition'

import { OTHER_LABEL } from './aliasGuards'

/** "אחר" as a word of its own (defined import-free in aliasGuards.ts). */
export { OTHER_LABEL }

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
 * follow-up's answer, so it is not asked again. Only the words the "אחר"
 * fallback read (`otherSaid`, readTurn.ts) count: a typed number, a phrasing of
 * the "אחר" option ("משהו אחר"), or another option's words beside it still get
 * the follow-up (code review 2026-10-13).
 */
export function preAnswerOtherFollowUp(
  definition: QuestionnaireDefinition,
  step: QuestionnaireStep,
  answer: Record<string, string[]>,
  otherSaid: string | undefined,
): Record<string, string[]> {
  if (step.type !== 'choice' || !otherSaid) return answer
  const other = otherOptionOf(step)
  if (!other || !(answer[step.id] ?? []).includes(other.id)) return answer
  const followUp = otherFollowUpOf(definition, step.id, other.id)
  return followUp ? { ...answer, [followUp.id]: [otherSaid] } : answer
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
