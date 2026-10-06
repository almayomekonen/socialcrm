/**
 * Which earlier answer a correction is about, when that is not a guess.
 *
 * The engine never edits an answer on its own. But a known-wrong value must not
 * reach the rep looking like confirmed truth, so a correction is matched to the
 * one answered question it could structurally be an answer to:
 *
 *   · a choice question it parses as a DIFFERENT selection for
 *     ("בעצם חינה" against an answered event type of "wedding"), or
 *   · a date question it reads as a date for ("טעיתי, 19.11").
 *
 * Exactly one such question: that answer is flagged as needing verification.
 * None, or more than one: the correction is shown unattributed. Free-text
 * questions are never matched, because almost anything "fits" them.
 */
import { findStep, type QuestionnaireDefinition, type QuestionnaireStep } from './definition'
import { parseChoice } from './parseAnswer'
import { checkTextAnswer } from './validateAnswer'

function fits(step: QuestionnaireStep, stored: string[], correction: string): boolean {
  if (step.type === 'choice') {
    const parsed = parseChoice(correction, step)
    return parsed.ok && parsed.optionIds.join(',') !== stored.join(',')
  }
  if (step.validate !== 'date') return false
  const checked = checkTextAnswer({ validate: 'date' }, correction)
  return checked.ok && !checked.notSet && correction.trim() !== stored[0]?.trim()
}

export function correctedStepId(
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
  correction: string,
): string | null {
  const targets = definition.steps.filter((s) => (answers[s.id]?.length ?? 0) > 0 && fits(s, answers[s.id], correction))
  return targets.length === 1 ? targets[0].id : null
}

/** Step ids whose answer a correction has called into question. */
export function stepsNeedingVerification(
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
  corrections: readonly string[],
): Map<string, string> {
  const flagged = new Map<string, string>()
  for (const c of corrections) {
    const id = correctedStepId(definition, answers, c)
    if (id && findStep(definition, id)) flagged.set(id, c)
  }
  return flagged
}
