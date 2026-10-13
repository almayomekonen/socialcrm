/**
 * Walking a questionnaire definition: which step comes next, and finding one by
 * id. Pure. Split from definition.ts (schema and validation) to keep that file
 * under the soft limit; definition.ts re-exports both, so importers are unchanged.
 */
import type { QuestionnaireDefinition, QuestionnaireStep } from './definition'

/** The step a session should be on, given the answers so far. Null = finished. */
export function nextStepAfter(
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
  afterStepId: string | null,
): QuestionnaireStep | null {
  const startIndex = afterStepId === null ? 0 : definition.steps.findIndex((s) => s.id === afterStepId) + 1
  if (startIndex <= 0 && afterStepId !== null) return null
  for (let i = startIndex; i < definition.steps.length; i++) {
    const step = definition.steps[i]
    if (!step.when) return step
    const given = answers[step.when.step] ?? []
    if (given.some((value) => step.when?.anyOf.includes(value))) return step
  }
  return null
}

export function findStep(definition: QuestionnaireDefinition, stepId: string | null): QuestionnaireStep | null {
  if (!stepId) return null
  return definition.steps.find((s) => s.id === stepId) ?? null
}
