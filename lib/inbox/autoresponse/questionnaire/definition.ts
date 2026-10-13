/**
 * The questionnaire definition: what a business asks, in what order.
 *
 * Pure data, validated the same way on the way in (the staff config script) and
 * on the way out (the worker, before it sends anything). A definition that fails
 * validation at read time silences the questionnaire for that business; it never
 * falls back to the AI agent.
 *
 * THE LIMITS ARE NOT ARBITRARY. Options are capped at 10 per question, the
 * Meta list message's row limit. Option labels are capped at OPTION_LABEL_MAX
 * (40, limits.ts): longer than Meta's list row title (24), so an owner can
 * write "באמצעות Excel או Google Sheets". A question with a label over 24 is
 * sent as the numbered text menu instead of a list or buttons (interactive.ts
 * checks every label against Meta's own limits before choosing a format).
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
import { OPTION_LABEL_MAX } from './limits'

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
  label: customerText(OPTION_LABEL_MAX, 'option label'),
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
  /**
   * "הכל" selects every option except "אחר" (allKeyword.ts). The owner's call,
   * per question: whether "everything" is meaningful depends on what the
   * options mean, which no label rule can tell. Multi-select only.
   */
  acceptsAll: z.boolean().optional(),
  options: z.array(optionSchema).min(2).max(10),
})

const textStepSchema = z.object({
  ...baseStep,
  type: z.literal('text'),
  /** Optional deterministic check on the reply (validateAnswer.ts). Absent: any non-empty reply. */
  validate: z.enum(['date', 'meaningful']).optional(),
  /** With `validate`: also accept an explicit "not decided yet", stored as `not_set`. */
  allowNotSet: z.boolean().optional(),
  /** Sent instead of the generic re-ask when `validate` rejects a reply. */
  invalidPrompt: customerText(900, 'invalidPrompt').optional(),
  /** The question asked again after a customer's own question, minus one-time words. */
  reaskPrompt: customerText(900, 'reaskPrompt').optional(),
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

      if (step.type === 'text' && step.allowNotSet && !step.validate) {
        ctx.addIssue({ code: 'custom', message: `step '${step.id}': allowNotSet needs validate`, path: ['steps', index] })
      }
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
        if (step.acceptsAll === true && step.multi !== true) {
          ctx.addIssue({
            code: 'custom',
            message: `step '${step.id}': acceptsAll needs multi`,
            path: ['steps', index, 'acceptsAll'],
          })
        }
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

export { answerStateKey, CORRECTIONS_KEY, rawAnswerKey } from './answerKeys'

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

// Walking a definition's steps lives in steps.ts; re-exported so importers are unchanged.
export { findStep, nextStepAfter } from './steps'
