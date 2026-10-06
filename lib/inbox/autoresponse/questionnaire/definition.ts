/**
 * The questionnaire definition: what a business asks, in what order.
 *
 * Pure data, validated the same way on the way in (the staff config script) and
 * on the way out (the worker, before it sends anything). A definition that fails
 * validation at read time silences the questionnaire for that business; it never
 * falls back to the AI agent.
 *
 * THE LIMITS ARE NOT ARBITRARY. They are the current Meta interactive-message
 * limits, applied now so that a later upgrade from numbered text menus to an
 * interactive list needs no configuration rewrite:
 *   · list message: at most 10 rows, row title at most 24 characters, row id at
 *     most 200 characters
 *   · reply buttons: at most 3, title at most 20 characters
 * Option labels are therefore capped at 24 and options at 10 per question.
 *
 * NO DASHES. Every customer-facing string passes through
 * finalizeCustomerFacingText before it is sent, which rewrites dashes into
 * commas. Rejecting them here is what makes "what staff configured" and "what
 * the customer receives" the same text.
 */
import { z } from 'zod'
import { hasCustomerFacingDash } from '../customerFacingText'
import { checkAliasCollisions } from './aliasMatch'
import { checkClosingVariants } from './closing'

export const QUESTIONNAIRE_SCHEMA_VERSION = 1

/** Longest single outbound message we will assemble (WhatsApp text limit is 4096). */
export const MAX_RENDERED_MESSAGE_CHARS = 3500

const ID = z
  .string()
  .regex(/^[a-z0-9_]{1,40}$/, 'id must be lowercase letters, digits or underscore (1 to 40 chars)')

const customerText = (max: number, field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} must not be empty`)
    .max(max, `${field} must be at most ${max} characters`)
    .refine((v) => !hasCustomerFacingDash(v), {
      message: `${field} must not contain a dash; the send path rewrites dashes into commas`,
    })

const conditionSchema = z.object({
  step: ID,
  anyOf: z.array(ID).min(1).max(10),
})

const optionSchema = z.object({
  id: ID,
  label: customerText(24, 'option label'),
  /**
   * Words a customer may use for this option instead of its number or label
   * (aliasMatch.ts). Never shown to the customer, so the dash rule does not
   * apply. Optional: without any, the step reads only numbers and labels.
   */
  aliases: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  /**
   * Presentation only: shown after the label in the text menu, e.g. "1. בוקר ☀️".
   * Never part of matching, the stored answer or the rep's summary, which all
   * use the id and the plain label. No letters or digits, so it cannot carry
   * meaning of its own.
   */
  icon: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .refine((v) => !/[\p{L}\p{N}]/u.test(v), { message: 'option icon must not contain letters or digits' })
    .optional(),
})

const baseStep = {
  id: ID,
  /** Short noun used in the rep-facing summary, e.g. "סוג האירוע". */
  label: customerText(40, 'step label'),
  prompt: customerText(900, 'step prompt'),
  when: conditionSchema.optional(),
}

const choiceStepSchema = z.object({
  ...baseStep,
  type: z.literal('choice'),
  multi: z.boolean().optional(),
  options: z.array(optionSchema).min(2).max(10),
})

const textStepSchema = z.object({
  ...baseStep,
  type: z.literal('text'),
})

const stepSchema = z.discriminatedUnion('type', [choiceStepSchema, textStepSchema])

export const questionnaireDefinitionSchema = z
  .object({
    schemaVersion: z.literal(QUESTIONNAIRE_SCHEMA_VERSION),
    revision: z.number().int().min(1),
    language: z.literal('he'),
    welcome: customerText(900, 'welcome'),
    closing: customerText(900, 'closing'),
    /** Closing chosen by a stored choice answer; first match wins (closing.ts). */
    closingVariants: z
      .array(z.object({ when: conditionSchema, text: customerText(900, 'closing variant') }))
      .max(10)
      .optional(),
    handoff: customerText(900, 'handoff'),
    /** Title of the rep-facing summary note, e.g. "שאלון וואטסאפ הושלם". */
    summaryTitle: customerText(80, 'summaryTitle'),
    maxInvalidAttempts: z.number().int().min(1).max(5),
    expireAfterHours: z.number().int().min(1).max(72),
    steps: z.array(stepSchema).min(1).max(12),
  })
  .superRefine((def, ctx) => {
    checkClosingVariants(def, ctx)
    const seen = new Map<string, number>()
    def.steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate step id '${step.id}'`, path: ['steps', index, 'id'] })
      }
      seen.set(step.id, index)

      if (step.type === 'choice') {
        const ids = new Set<string>()
        const labels = new Set<string>()
        step.options.forEach((option, optionIndex) => {
          if (ids.has(option.id)) {
            ctx.addIssue({
              code: 'custom',
              message: `duplicate option id '${option.id}' in step '${step.id}'`,
              path: ['steps', index, 'options', optionIndex, 'id'],
            })
          }
          // Meta refuses interactive rows whose titles repeat, and a repeated
          // label would also make the text menu ambiguous to answer by name.
          const label = option.label.trim()
          if (labels.has(label)) {
            ctx.addIssue({
              code: 'custom',
              message: `duplicate option label '${label}' in step '${step.id}'`,
              path: ['steps', index, 'options', optionIndex, 'label'],
            })
          }
          ids.add(option.id)
          labels.add(label)
        })
        checkAliasCollisions(step, index, ctx)
      }

      if (!step.when) return
      const sourceIndex = seen.get(step.when.step)
      // A condition may only look backwards: the answer has to exist before the
      // question that depends on it is reached, and a forward reference is how
      // a definition becomes a cycle.
      if (sourceIndex === undefined || sourceIndex >= index) {
        ctx.addIssue({
          code: 'custom',
          message: `step '${step.id}' conditions on '${step.when.step}', which is not an earlier step`,
          path: ['steps', index, 'when', 'step'],
        })
        return
      }
      const source = def.steps[sourceIndex]
      if (source.type !== 'choice') {
        ctx.addIssue({
          code: 'custom',
          message: `step '${step.id}' conditions on '${source.id}', which is not a choice question`,
          path: ['steps', index, 'when', 'step'],
        })
        return
      }
      const optionIds = new Set(source.options.map((o) => o.id))
      step.when.anyOf.forEach((optionId, i) => {
        if (!optionIds.has(optionId)) {
          ctx.addIssue({
            code: 'custom',
            message: `step '${step.id}' conditions on unknown option '${optionId}' of '${source.id}'`,
            path: ['steps', index, 'when', 'anyOf', i],
          })
        }
      })
    })
  })

/**
 * Where a choice answer read from natural words (aliasMatch.ts) keeps those
 * words, beside the option id: `answers["timing:raw"] = ["רק בערב אחרי העבודה"]`.
 * A step id cannot contain ':', so this key can never be mistaken for a step.
 */
export function rawAnswerKey(stepId: string): string {
  return `${stepId}:raw`
}

export type QuestionnaireDefinition = z.infer<typeof questionnaireDefinitionSchema>
export type QuestionnaireStep = QuestionnaireDefinition['steps'][number]
export type QuestionnaireChoiceStep = Extract<QuestionnaireStep, { type: 'choice' }>
export type QuestionnaireOption = QuestionnaireChoiceStep['options'][number]

export type ParsedDefinition =
  | { ok: true; definition: QuestionnaireDefinition }
  | { ok: false; errors: string[] }

/** Validate an unknown value (a jsonb column, a config file) as a definition. */
export function parseQuestionnaireDefinition(value: unknown): ParsedDefinition {
  const raw = typeof value === 'string' ? safeJson(value) : value
  const result = questionnaireDefinitionSchema.safeParse(raw)
  if (result.success) return { ok: true, definition: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

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
