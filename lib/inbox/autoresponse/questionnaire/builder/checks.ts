/**
 * Publish validation: "is this questionnaire ready to talk to customers?"
 *
 * The authority is the RUNTIME schema (`questionnaireDefinitionSchema`), the
 * same one the worker uses before it sends anything. On top of it, a few
 * checks only a builder needs (a question no answer can reach; a message too
 * long to send; "אחר" with nothing asked after it).
 *
 * Every problem comes back as a structured `BuilderIssue` — a code plus the ids
 * it concerns — never as raw schema text. The owner-facing Hebrew lives in
 * issues.ts, so neither a browser nor a staff terminal ever shows
 * "conditions on unknown option 'wedding' of 'event_type'".
 */
import { MAX_RENDERED_MESSAGE_CHARS, nextStepAfter, parseQuestionnaireDefinition, questionnaireDefinitionSchema } from '../definition'
import type { QuestionnaireDefinition } from '../definition'
import { renderOpening, renderQuestion } from '../render'
import type { ConvertError } from './convert'
import { OTHER_LABEL } from './editorBase'
import type { IdError } from './ids'

export type IssueCode =
  | 'missing_text'
  | 'too_long'
  | 'no_questions'
  | 'too_few_options'
  | 'too_many_items'
  | 'duplicate_option_label'
  | 'phrasing_on_two_options'
  | 'condition_on_later_or_missing_question'
  | 'condition_on_non_choice'
  | 'condition_on_deleted_option'
  | 'condition_needs_answer'
  | 'ending_condition_on_non_choice'
  | 'ending_condition_on_deleted_option'
  | 'icon_invalid'
  | 'message_too_long'
  | 'unreachable_question'
  | 'other_without_follow_up'
  | 'conditions_more_than_one_not_supported_yet'
  | 'ending_needs_one_condition'
  | 'messages_not_supported_for_choice'
  | 'unknown_id'
  | 'duplicate_id'
  | 'invalid'

export type BuilderIssue = {
  code: IssueCode
  severity: 'error' | 'warning'
  questionId?: string
  optionId?: string
  endingIndex?: number
  /** The field the problem is in: 'prompt', 'label', 'opening', 'message', … */
  field?: string
}

const FIELD_NAMES: Record<string, string> = {
  welcome: 'opening',
  closing: 'standardEnding',
  handoff: 'handoffMessage',
  summaryTitle: 'summaryTitle',
  prompt: 'prompt',
  label: 'label',
  text: 'message',
  aliases: 'phrasings',
  icon: 'icon',
  invalidPrompt: 'notUnderstood',
  reaskPrompt: 'askAgainAfterQuestion',
}

function codeFor(message: string, zodCode: string, path: readonly (string | number)[]): IssueCode {
  if (message.includes('must not be empty')) return 'missing_text'
  if (message.includes('must be at most')) return 'too_long'
  if (message.includes('duplicate option label')) return 'duplicate_option_label'
  if (message.includes('belongs to both')) return 'phrasing_on_two_options'
  if (message.includes('icon must not contain')) return 'icon_invalid'
  if (path[0] === 'closingVariants') {
    if (message.includes('unknown option')) return 'ending_condition_on_deleted_option'
    if (message.includes('not a choice question')) return 'ending_condition_on_non_choice'
  }
  if (message.includes('unknown option')) return 'condition_on_deleted_option'
  if (message.includes('not a choice question')) return 'condition_on_non_choice'
  if (message.includes('not an earlier step')) return 'condition_on_later_or_missing_question'
  if (zodCode === 'too_small' && path[path.length - 1] === 'anyOf') return 'condition_needs_answer'
  if (zodCode === 'too_small' && path.length === 1 && path[0] === 'steps') return 'no_questions'
  if (zodCode === 'too_small' && path[path.length - 1] === 'options') return 'too_few_options'
  if (zodCode === 'too_big') return 'too_many_items'
  return 'invalid'
}

/** Translate runtime-schema issues into Builder issues, with ids instead of indexes. */
function fromSchema(definition: QuestionnaireDefinition): BuilderIssue[] {
  const result = questionnaireDefinitionSchema.safeParse(definition)
  if (result.success) return []
  const emptyLabel = (path: readonly PropertyKey[]) => {
    const step = typeof path[1] === 'number' ? definition.steps[path[1]] : undefined
    const option = step?.type === 'choice' && typeof path[3] === 'number' ? step.options[path[3]] : undefined
    return option !== undefined && option.label.trim() === ''
  }
  // Two blank answers are "missing", not "the same name twice": one problem, said once.
  const issues = result.error.issues.filter((i) => !(i.message.includes('duplicate option label') && emptyLabel(i.path)))
  return issues.map((issue) => {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol')
    const out: BuilderIssue = { code: codeFor(issue.message, issue.code, path), severity: 'error' }
    if (path[0] === 'steps' && typeof path[1] === 'number') {
      const step = definition.steps[path[1]]
      if (step) out.questionId = step.id
      if (path[2] === 'options' && typeof path[3] === 'number' && step?.type === 'choice') {
        out.optionId = step.options[path[3]]?.id
      }
    }
    if (path[0] === 'closingVariants' && typeof path[1] === 'number') out.endingIndex = path[1]
    const named = [...path].reverse().find((p) => typeof p === 'string' && FIELD_NAMES[p])
    if (typeof named === 'string') out.field = FIELD_NAMES[named]
    return out
  })
}

/** Questions no combination of answers can reach (only possible through a chain of conditions). */
function unreachable(definition: QuestionnaireDefinition): string[] {
  const reachable = new Set<string>()
  for (const step of definition.steps) {
    if (!step.when) reachable.add(step.id)
    else if (reachable.has(step.when.step) && step.when.anyOf.length) reachable.add(step.id)
  }
  return definition.steps.filter((s) => !reachable.has(s.id)).map((s) => s.id)
}

function builderChecks(definition: QuestionnaireDefinition): BuilderIssue[] {
  const issues: BuilderIssue[] = []
  for (const id of unreachable(definition)) issues.push({ code: 'unreachable_question', severity: 'error', questionId: id })

  const first = nextStepAfter(definition, {}, null)
  const rendered: Array<{ text: string; questionId?: string; field: string }> = []
  if (first) rendered.push({ text: renderOpening(definition, first), questionId: first.id, field: 'opening' })
  for (const step of definition.steps) rendered.push({ text: renderQuestion(step), questionId: step.id, field: 'prompt' })
  for (const r of rendered) {
    if (r.text.length > MAX_RENDERED_MESSAGE_CHARS) {
      issues.push({ code: 'message_too_long', severity: 'error', questionId: r.questionId, field: r.field })
    }
  }

  // "אחר" with nothing asked afterwards: a suggestion, never a blocker.
  for (const step of definition.steps) {
    if (step.type !== 'choice') continue
    for (const option of step.options) {
      if (!OTHER_LABEL.test(option.label)) continue
      const followed = definition.steps.some((s) => s.when?.step === step.id && s.when.anyOf.includes(option.id))
      if (!followed) issues.push({ code: 'other_without_follow_up', severity: 'warning', questionId: step.id, optionId: option.id })
    }
  }
  return issues
}

export function convertErrorIssue(error: ConvertError | IdError): BuilderIssue {
  return {
    code: error.code,
    severity: 'error',
    ...('questionId' in error && error.questionId ? { questionId: error.questionId } : {}),
    ...('endingIndex' in error && error.endingIndex !== undefined ? { endingIndex: error.endingIndex } : {}),
    ...('id' in error ? (error.questionId ? { optionId: error.id } : { questionId: error.id }) : {}),
  }
}

/** Every issue that stands between this definition and customers. Errors block publish; warnings do not. */
export function checkDefinitionForPublish(definition: QuestionnaireDefinition): { ready: boolean; issues: BuilderIssue[] } {
  const schemaIssues = fromSchema(definition)
  // Builder checks need a structurally sound definition to reason about.
  const extra = parseQuestionnaireDefinition(definition).ok ? builderChecks(definition) : []
  const issues = [...schemaIssues, ...extra]
  return { ready: !issues.some((i) => i.severity === 'error'), issues }
}
