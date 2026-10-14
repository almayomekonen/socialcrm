/**
 * Runtime definition ⇄ Builder model. Pure and lossless.
 *
 * The runtime definition is the only thing stored and executed. These two
 * functions are the whole translation layer: `toBuilder` for reading,
 * `toDefinition` for writing. A round-trip test runs every real definition
 * (agencies 103 and 158, the samples) through both and requires the result to
 * equal the input, so a runtime field added without a Builder counterpart fails
 * loudly instead of being silently dropped.
 *
 * Canonical form: an absent boolean and `false` mean the same to the runtime,
 * so `multi`, `acceptsAll`, `allowNotSet` and an empty phrasing list are
 * written only when they say something.
 */
import type { QuestionnaireDefinition, QuestionnaireStep } from '../definition'
import { QUESTIONNAIRE_SCHEMA_VERSION } from '../definition'
import type { AnswerSpec, BuilderQuestionnaire, IdentifiedQuestionnaire, ShownWhen } from './model'

type Condition = { step: string; anyOf: string[] }

function shownWhenOf(when: Condition | undefined): ShownWhen {
  return when ? { mode: 'all', conditions: [{ questionId: when.step, anyOf: [...when.anyOf] }] } : { mode: 'always' }
}

function answerOf(step: QuestionnaireStep): AnswerSpec {
  if (step.type === 'choice') {
    return {
      kind: step.multi === true ? 'multi_choice' : 'single_choice',
      options: step.options.map((o) => ({
        id: o.id,
        label: o.label,
        ...(o.icon !== undefined ? { icon: o.icon } : {}),
        phrasings: [...(o.aliases ?? [])],
      })),
      ...(step.multi === true && step.acceptsAll === true ? { allowAll: true } : {}),
    }
  }
  if (step.validate === 'date') return { kind: 'date', notSetAllowed: step.allowNotSet === true }
  if (step.validate === 'meaningful') return { kind: 'text', notSetAllowed: step.allowNotSet === true }
  return { kind: 'text_unchecked' }
}

/** Read: what is stored, in the owner's terms. */
export function toBuilder(definition: QuestionnaireDefinition): BuilderQuestionnaire {
  return {
    opening: definition.welcome,
    questions: definition.steps.map((step) => ({
      id: step.id,
      label: step.label,
      prompt: step.prompt,
      answer: answerOf(step),
      shownWhen: shownWhenOf(step.when),
      messages:
        step.type === 'text'
          ? {
              ...(step.invalidPrompt !== undefined ? { notUnderstood: step.invalidPrompt } : {}),
              ...(step.reaskPrompt !== undefined ? { askAgainAfterQuestion: step.reaskPrompt } : {}),
            }
          : {},
    })),
    endings: {
      standard: definition.closing,
      custom: (definition.closingVariants ?? []).map((v) => ({
        sentWhen: { mode: 'all' as const, conditions: [{ questionId: v.when.step, anyOf: [...v.when.anyOf] }] },
        message: v.text,
      })),
    },
    handoffMessage: definition.handoff,
    summaryTitle: definition.summaryTitle,
    settings: {
      attemptsBeforePerson: definition.maxInvalidAttempts,
      abandonAfterHours: definition.expireAfterHours,
    },
  }
}

/**
 * Why a Builder model cannot be stored in runtime form yet. These are limits of
 * the V1 runtime, refused at save so nothing is ever silently dropped.
 */
export type ConvertError =
  | { code: 'conditions_more_than_one_not_supported_yet'; questionId?: string; endingIndex?: number }
  | { code: 'ending_needs_one_condition'; endingIndex: number }
  | { code: 'messages_not_supported_for_choice'; questionId: string }

function whenOf(shownWhen: ShownWhen): Condition | undefined | 'too_many' {
  if (shownWhen.mode === 'always' || shownWhen.conditions.length === 0) return undefined
  if (shownWhen.conditions.length > 1) return 'too_many'
  const c = shownWhen.conditions[0]
  return { step: c.questionId, anyOf: [...c.anyOf] }
}

/** Write: the owner's terms back into the runtime definition. */
export function toDefinition(
  builder: IdentifiedQuestionnaire,
  revision: number,
): { ok: true; definition: QuestionnaireDefinition } | { ok: false; error: ConvertError } {
  const steps: QuestionnaireStep[] = []
  for (const q of builder.questions) {
    const when = whenOf(q.shownWhen)
    if (when === 'too_many') return { ok: false, error: { code: 'conditions_more_than_one_not_supported_yet', questionId: q.id } }
    const base = { id: q.id, label: q.label, prompt: q.prompt, ...(when ? { when } : {}) }
    const a = q.answer
    if (a.kind === 'single_choice' || a.kind === 'multi_choice') {
      if (q.messages?.notUnderstood !== undefined || q.messages?.askAgainAfterQuestion !== undefined) {
        return { ok: false, error: { code: 'messages_not_supported_for_choice', questionId: q.id } }
      }
      steps.push({
        ...base,
        type: 'choice',
        ...(a.kind === 'multi_choice' ? { multi: true } : {}),
        ...(a.kind === 'multi_choice' && a.allowAll === true ? { acceptsAll: true } : {}),
        options: a.options.map((o) => ({
          id: o.id,
          label: o.label,
          ...(o.phrasings.length ? { aliases: [...o.phrasings] } : {}),
          ...(o.icon !== undefined ? { icon: o.icon } : {}),
        })),
      } as QuestionnaireStep)
      continue
    }
    const checking =
      a.kind === 'date'
        ? { validate: 'date' as const, ...(a.notSetAllowed ? { allowNotSet: true } : {}) }
        : a.kind === 'text'
          ? { validate: 'meaningful' as const, ...(a.notSetAllowed ? { allowNotSet: true } : {}) }
          : {}
    steps.push({
      ...base,
      type: 'text',
      ...checking,
      ...(q.messages?.notUnderstood !== undefined ? { invalidPrompt: q.messages.notUnderstood } : {}),
      ...(q.messages?.askAgainAfterQuestion !== undefined ? { reaskPrompt: q.messages.askAgainAfterQuestion } : {}),
    } as QuestionnaireStep)
  }

  const closingVariants: Array<{ when: Condition; text: string }> = []
  for (const [index, ending] of builder.endings.custom.entries()) {
    if (ending.sentWhen.conditions.length === 0) return { ok: false, error: { code: 'ending_needs_one_condition', endingIndex: index } }
    const when = whenOf(ending.sentWhen)
    if (when === 'too_many') return { ok: false, error: { code: 'conditions_more_than_one_not_supported_yet', endingIndex: index } }
    closingVariants.push({ when: when as Condition, text: ending.message })
  }

  const definition = {
    schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
    revision,
    language: 'he',
    welcome: builder.opening,
    closing: builder.endings.standard,
    ...(closingVariants.length ? { closingVariants } : {}),
    handoff: builder.handoffMessage,
    summaryTitle: builder.summaryTitle,
    maxInvalidAttempts: builder.settings.attemptsBeforePerson,
    expireAfterHours: builder.settings.abandonAfterHours,
    steps,
  } as QuestionnaireDefinition
  return { ok: true, definition }
}
