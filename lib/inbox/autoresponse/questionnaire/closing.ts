/**
 * Which closing message a completed questionnaire sends.
 *
 * A definition may list `closingVariants`: a closing text chosen by a stored
 * choice answer, e.g. a different goodbye for one kind of request, or a link
 * that is only relevant to some of them. The first variant whose condition
 * holds wins; otherwise the definition's plain `closing` is sent. A definition
 * without variants sends `closing`, exactly as before.
 *
 * The condition reads the persisted option ids, never free text: what decides
 * the message is what the customer selected, not a word they happened to use
 * later on.
 */
import type { z } from 'zod'

type Condition = { step: string; anyOf: string[] }
type Answers = Record<string, string[]>
type DefinitionShape = {
  closing: string
  closingVariants?: Array<{ when: Condition; text: string }>
  steps: Array<{ id: string; type: string; options?: Array<{ id: string }> }>
}

export function conditionMet(when: Condition, answers: Answers): boolean {
  const given = answers[when.step] ?? []
  return given.some((value) => when.anyOf.includes(value))
}

export function closingFor(definition: DefinitionShape, answers: Answers): string {
  const variant = definition.closingVariants?.find((v) => conditionMet(v.when, answers))
  return variant ? variant.text : definition.closing
}

/** Every variant must point at a real choice question and its real options. */
export function checkClosingVariants(definition: DefinitionShape, ctx: z.RefinementCtx): void {
  definition.closingVariants?.forEach((variant, index) => {
    const path = ['closingVariants', index, 'when']
    const source = definition.steps.find((s) => s.id === variant.when.step)
    if (!source || source.type !== 'choice') {
      ctx.addIssue({
        code: 'custom',
        message: `closing variant ${index} conditions on '${variant.when.step}', which is not a choice question`,
        path: [...path, 'step'],
      })
      return
    }
    const optionIds = new Set((source.options ?? []).map((o) => o.id))
    variant.when.anyOf.forEach((optionId, i) => {
      if (!optionIds.has(optionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `closing variant ${index} conditions on unknown option '${optionId}' of '${source.id}'`,
          path: [...path, 'anyOf', i],
        })
      }
    })
  })
}
