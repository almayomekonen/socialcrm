/**
 * The Builder model: the questionnaire in the owner's terms.
 *
 * NOT A SECOND SOURCE OF TRUTH. What is stored, published and executed is the
 * runtime definition (../definition.ts). This model is how the API speaks about
 * it, and it converts to and from the runtime definition losslessly
 * (convert.ts). Only the engine-terminology fields are re-expressed — `when`,
 * `closingVariants`, `validate`, `allowNotSet`, `aliases`; everything else
 * (ids, prompts, labels, icons, order, messages) passes through unchanged.
 *
 * The three things the approved conversation editor shows for every question
 * are all first-class here: what the customer sees (`prompt`), how they can
 * answer (`answer`), and when the question appears (`shownWhen`).
 *
 * The DRAFT schema below is lenient on purpose: a draft may be incomplete (an
 * empty prompt, one option, no questions yet). It only enforces what keeps a
 * draft storable and renderable — types, sizes and id shapes. Completeness is
 * the publish check's job (checks.ts), which uses the real runtime schema.
 */
import { z } from 'zod'

const ID = z.string().regex(/^[a-z0-9_]{1,40}$/)
/**
 * The browser's name for an entity the server has not identified yet. Lets an
 * unsaved option be referenced by a condition ("אחר" and its follow-up, added
 * together). Resolved to a fresh server id by ids.ts and never stored.
 */
export const REF = z.string().regex(/^new_[a-z0-9]{1,20}$/)
const text = (max: number) => z.string().max(max)

export const builderOptionSchema = z.object({
  /** Absent: a new option; the server assigns its id. */
  id: ID.optional(),
  ref: REF.optional(),
  label: text(24),
  icon: z.string().max(8).optional(),
  /** Other ways customers write this option ("אנחנו מתחתנים"). */
  phrasings: z.array(text(40)).max(40).default([]),
})

const conditionSchema = z.object({ questionId: ID, anyOf: z.array(ID).max(10) })

/**
 * When a question appears. A list of conditions, not one: adding AND/OR later
 * is a runtime extension, not an API change. V1 publishes at most one
 * (checks.ts: `conditions_more_than_one_not_supported_yet`).
 */
export const shownWhenSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('always') }),
  z.object({ mode: z.literal('all'), conditions: z.array(conditionSchema).max(5) }),
])

/** How the customer answers. */
export const answerSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single_choice'), options: z.array(builderOptionSchema).max(10) }),
  z.object({ kind: z.literal('multi_choice'), options: z.array(builderOptionSchema).max(10) }),
  /** Free text, checked only for obvious non-answers. */
  z.object({ kind: z.literal('text'), notSetAllowed: z.boolean().default(false) }),
  /** A date or period; "not decided yet" optionally accepted. */
  z.object({ kind: z.literal('date'), notSetAllowed: z.boolean().default(true) }),
  /** Free text with no checking at all: questionnaires authored before checking existed. */
  z.object({ kind: z.literal('text_unchecked') }),
])

export const builderQuestionSchema = z.object({
  id: ID.optional(),
  ref: REF.optional(),
  /** The short name the rep reads in the summary ("תאריך האירוע"). */
  label: text(40),
  /** What the customer sees. */
  prompt: text(900),
  answer: answerSpecSchema,
  shownWhen: shownWhenSchema.default({ mode: 'always' }),
  messages: z
    .object({
      /** Sent when the reply is not an answer (text questions). */
      notUnderstood: text(900).optional(),
      /** The question again after a customer's own question, without one-time words. */
      askAgainAfterQuestion: text(900).optional(),
    })
    .default({}),
})

export const builderEndingSchema = z.object({
  /** When this ending is sent instead of the standard one. */
  sentWhen: z.object({ mode: z.literal('all'), conditions: z.array(conditionSchema).max(5) }),
  message: text(900),
})

export const builderQuestionnaireSchema = z.object({
  opening: text(900),
  questions: z.array(builderQuestionSchema).max(12),
  endings: z.object({
    standard: text(900),
    /** Checked top to bottom; the first that matches is sent. */
    custom: z.array(builderEndingSchema).max(10).default([]),
  }),
  handoffMessage: text(900),
  summaryTitle: text(80),
  settings: z.object({
    attemptsBeforePerson: z.number().int().min(1).max(5),
    abandonAfterHours: z.number().int().min(1).max(72),
  }),
})

export type BuilderOption = z.infer<typeof builderOptionSchema>
export type ShownWhen = z.infer<typeof shownWhenSchema>
export type AnswerSpec = z.infer<typeof answerSpecSchema>
export type BuilderQuestion = z.infer<typeof builderQuestionSchema>
export type BuilderEnding = z.infer<typeof builderEndingSchema>
export type BuilderQuestionnaire = z.infer<typeof builderQuestionnaireSchema>
export type BuilderQuestionnaireInput = z.input<typeof builderQuestionnaireSchema>

/** A question or option after the server assigned every id. */
export type IdentifiedQuestionnaire = Omit<BuilderQuestionnaire, 'questions'> & {
  questions: Array<
    Omit<BuilderQuestion, 'id' | 'answer'> & {
      id: string
      answer:
        | { kind: 'single_choice' | 'multi_choice'; options: Array<BuilderOption & { id: string }> }
        | Exclude<AnswerSpec, { kind: 'single_choice' | 'multi_choice' }>
    }
  >
}
