/**
 * The builder's derived sentences in the interface language (Phase E5c): the
 * publish check's problems (issues.ts `describeIssue`), the condition sentences
 * (conditionText.ts) and the test chat's "why" lines (explainText.ts).
 *
 * Display only. Hebrew returns the producer's own result (pinned by
 * questionnaireCopyPin.test.ts); every other language words the same code
 * from `admin.questionnaireCopy`. The business's words (question names,
 * answers, prompts, the customer's own messages) are quoted as written. The
 * producers in lib/inbox/autoresponse/questionnaire/builder are unchanged.
 */
import type { Translator } from '@/lib/i18n/translate'
import { NOT_SET_SUMMARY } from '@/lib/inbox/autoresponse/questionnaire/render'
import type { BuilderIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/checks'
import { chosenSentence, describeCondition, questionName } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import { keyOf, optionsOf, type Condition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { explainKept, explainReason, explainRecognized } from '@/lib/inbox/autoresponse/questionnaire/builder/explainText'
import { describeIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/issues'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { normalizeCustomerText } from '@/lib/inbox/autoresponse/questionnaire/builder/normalize'
import type { TurnExplanation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { cardIssueText } from './builderCopy'

type Key = Parameters<Translator>[0]
const he = (t: Translator) => t.locale === 'he'

const FIELD: Record<string, Key> = {
  opening: 'admin.questionnaireCopy.field.opening',
  standardEnding: 'admin.questionnaireCopy.field.standardEnding',
  handoffMessage: 'admin.questionnaireCopy.field.handoffMessage',
  summaryTitle: 'admin.questionnaireCopy.field.summaryTitle',
  prompt: 'admin.questionnaireCopy.field.prompt',
  label: 'admin.questionnaireCopy.field.label',
  message: 'admin.questionnaireCopy.field.message',
  phrasings: 'admin.questionnaireCopy.field.phrasings',
  icon: 'admin.questionnaireCopy.field.icon',
  notUnderstood: 'admin.questionnaireCopy.field.notUnderstood',
  askAgainAfterQuestion: 'admin.questionnaireCopy.field.askAgainAfterQuestion',
}

/** Codes whose sentence names the question (`{question}`) and nothing else. */
const BY_QUESTION: Record<string, Key> = {
  too_few_options: 'admin.questionnaireCopy.issue.tooFewOptions',
  duplicate_option_label: 'admin.questionnaireCopy.issue.duplicateOption',
  phrasing_on_two_options: 'admin.questionnaireCopy.issue.phrasingTwice',
  condition_on_later_or_missing_question: 'admin.questionnaireCopy.issue.laterOrMissing',
  condition_on_non_choice: 'admin.questionnaireCopy.issue.onNonChoice',
  condition_on_deleted_option: 'admin.questionnaireCopy.issue.deletedOption',
  message_too_long: 'admin.questionnaireCopy.issue.messageTooLong',
  unreachable_question: 'admin.questionnaireCopy.issue.unreachable',
  phrasing_is_command: 'admin.questionnaireCopy.issue.phrasingCommand',
  phrasing_is_all: 'admin.questionnaireCopy.issue.phrasingAll',
  phrasing_is_filler: 'admin.questionnaireCopy.issue.phrasingFiller',
  messages_not_supported_for_choice: 'admin.questionnaireCopy.issue.choiceMessages',
}

/** Codes whose sentence names nothing. */
const PLAIN: Record<string, Key> = {
  no_questions: 'admin.questionnaireCopy.issue.noQuestions',
  ending_condition_on_deleted_option: 'admin.questionnaireCopy.issue.endingDeletedOption',
  ending_condition_on_non_choice: 'admin.questionnaireCopy.issue.endingNonChoice',
  ending_needs_one_condition: 'admin.questionnaireCopy.issue.endingNeedsOne',
  conditions_more_than_one_not_supported_yet: 'admin.questionnaireCopy.issue.oneCondition',
  unknown_id: 'admin.questionnaireCopy.issue.changedElsewhere',
  duplicate_id: 'admin.questionnaireCopy.issue.changedElsewhere',
}

/** The same problem `describeIssue` words, in the interface language (the same lookups, by draft key). */
export function issueTextIn(issue: BuilderIssue & { text?: string }, model: BuilderQuestionnaire, t: Translator): string {
  if (he(t)) return issue.text ?? describeIssue(issue, model)
  const m = normalizeCustomerText(model)
  const q = m.questions.find((x) => keyOf(x) === issue.questionId)
  const question = q ? `"${q.prompt || q.label || t('admin.questionnaireCopy.issue.unnamedQuestion')}"` : t('admin.questionnaireCopy.issue.theQuestionnaire')
  const option = q ? optionsOf(q).find((o) => keyOf(o) === issue.optionId) : undefined
  const optionName = option ? `"${option.label}"` : t('admin.questionnaireCopy.issue.anOption')
  const field = t((issue.field && FIELD[issue.field]) || 'admin.questionnaireCopy.field.unknown')
  const code = issue.code as string
  if (BY_QUESTION[code]) return t(BY_QUESTION[code], { question })
  if (PLAIN[code]) return t(PLAIN[code])
  switch (code) {
    case 'missing_text':
      if (issue.optionId) return t('admin.questionnaireCopy.issue.optionUnnamed', { question })
      return q ? t('admin.questionnaireCopy.issue.missingIn', { field, question }) : t('admin.questionnaireCopy.issue.missing', { field })
    case 'too_long':
      return q ? t('admin.questionnaireCopy.issue.tooLongIn', { field, question }) : t('admin.questionnaireCopy.issue.tooLong', { field })
    case 'too_many_items':
      return q ? t('admin.questionnaireCopy.issue.tooManyItemsIn', { question }) : t('admin.questionnaireCopy.issue.tooManyItems')
    case 'condition_needs_answer':
      return issue.endingIndex !== undefined ? t('admin.questionnaireCopy.issue.endingNeedsAnswer') : t('admin.questionnaireCopy.issue.needsAnswer', { question })
    case 'icon_invalid':
      return t('admin.questionnaireCopy.issue.iconInvalid', { option: optionName })
    case 'other_without_follow_up':
      return t('admin.questionnaireCopy.issue.otherNoFollowUp', { option: optionName })
    default:
      return q ? t('admin.questionnaireCopy.issue.genericIn', { question }) : t('admin.questionnaireCopy.issue.generic')
  }
}

/** builderCopy's `cardIssueText` (the short form inside a card), in the interface language. */
export function cardIssueTextIn(issue: BuilderIssue & { text: string }, model: BuilderQuestionnaire, t: Translator): string {
  if (he(t)) return cardIssueText(issue)
  if (issue.code === 'missing_text' && issue.field === 'prompt') return t('admin.questionnaireCopy.cardIssue.prompt')
  if (issue.code === 'missing_text' && issue.field === 'label') return t('admin.questionnaireCopy.cardIssue.label')
  return issueTextIn(issue, model, t)
}

export function questionNameIn(q: { label: string; prompt: string }, t: Translator): string {
  return he(t) ? questionName(q) : q.label.trim() || q.prompt.trim() || t('admin.questionnaireCopy.conditions.unnamedQuestion')
}

function joinOr(items: string[], t: Translator): string {
  if (items.length <= 1) return items[0] ?? ''
  return t('admin.questionnaireCopy.conditions.or', { first: items.slice(0, -1).join(t('admin.questionnaireCopy.conditions.list')), last: items[items.length - 1] })
}

function answersOf(m: BuilderQuestionnaire, condition: Condition, t: Translator) {
  const source = m.questions.find((q) => keyOf(q) === condition.questionId)
  const labels = source ? condition.anyOf.map((k) => optionsOf(source).find((o) => keyOf(o) === k)?.label.trim() || t('admin.questionnaireCopy.conditions.deletedAnswer')) : []
  return { source, labels }
}

/** conditionText's `describeCondition`, in the interface language. */
export function describeConditionIn(m: BuilderQuestionnaire, condition: Condition | null, t: Translator): string | null {
  if (he(t)) return describeCondition(m, condition)
  if (!condition) return null
  const { source, labels } = answersOf(m, condition, t)
  if (!source) return t('admin.questionnaireCopy.conditions.deletedQuestion')
  const question = questionNameIn(source, t)
  if (!labels.length) return t('admin.questionnaireCopy.conditions.noAnswer', { question })
  return t('admin.questionnaireCopy.conditions.chose', { answers: joinOr(labels, t), question })
}

/** conditionText's `chosenSentence`, in the interface language. */
export function chosenSentenceIn(m: BuilderQuestionnaire, condition: Condition | null, t: Translator): string | null {
  if (he(t)) return chosenSentence(m, condition)
  if (!condition) return null
  const { source, labels } = answersOf(m, condition, t)
  if (!source) return null
  return labels.length ? t('admin.questionnaireCopy.conditions.chosen', { answers: joinOr(labels, t) }) : null
}

const REASONS: Record<string, Key> = {
  started: 'admin.questionnaireCopy.explain.started',
  restarted: 'admin.questionnaireCopy.explain.restarted',
  answered: 'admin.questionnaireCopy.explain.answered',
  completed: 'admin.questionnaireCopy.explain.completed',
  customer_question: 'admin.questionnaireCopy.explain.customerQuestion',
  customer_questions: 'admin.questionnaireCopy.explain.customerQuestions',
  early_messages: 'admin.questionnaireCopy.explain.earlyMessages',
  ignorable_only: 'admin.questionnaireCopy.explain.ignorableOnly',
  human_request: 'admin.questionnaireCopy.explain.humanRequest',
  declined: 'admin.questionnaireCopy.explain.declined',
  opt_out: 'admin.questionnaireCopy.explain.optOut',
  invalid_limit: 'admin.questionnaireCopy.explain.invalidLimit',
  expired: 'admin.questionnaireCopy.explain.expired',
  session_closed: 'admin.questionnaireCopy.explain.sessionClosed',
  reprompt_invalid_choice: 'admin.questionnaireCopy.explain.invalidChoice',
  reprompt_invalid_multi: 'admin.questionnaireCopy.explain.invalidMulti',
  reprompt_invalid_text: 'admin.questionnaireCopy.explain.invalidText',
  reprompt_media: 'admin.questionnaireCopy.explain.media',
  reprompt_voice: 'admin.questionnaireCopy.explain.voice',
}

export function explainReasonIn(e: TurnExplanation, t: Translator): string {
  return he(t) ? explainReason(e) : t(REASONS[e.reason] ?? 'admin.questionnaireCopy.explain.fallback')
}

/** explainText's lines per recorded answer. The answer itself is quoted as recorded (a "not set" answer is the runtime's own word). */
export function explainRecognizedIn(m: BuilderQuestionnaire, e: TurnExplanation, t: Translator): string[] {
  if (he(t)) return explainRecognized(m, e)
  return e.recognized.map((r) => {
    const q = m.questions.find((x) => keyOf(x) === r.questionId)
    const name = q ? questionNameIn(q, t) : t('admin.questionnaireCopy.explain.question')
    let value: string
    if (r.notSet) value = NOT_SET_SUMMARY
    else if (r.optionIds) value = r.optionIds.map((id) => (q ? optionsOf(q).find((o) => keyOf(o) === id)?.label : undefined) ?? id).join(', ')
    else value = r.text ?? ''
    const words = r.fromWords && r.optionIds ? t('admin.questionnaireCopy.explain.fromWords', { words: r.fromWords }) : ''
    return `${name}: ${value}${words}`
  })
}

export function explainKeptIn(e: TurnExplanation, t: Translator): string[] {
  if (he(t)) return explainKept(e)
  return [
    ...e.keptForRep.questions.map((text) => t('admin.questionnaireCopy.explain.keptQuestion', { text })),
    ...e.keptForRep.corrections.map((text) => t('admin.questionnaireCopy.explain.keptCorrection', { text })),
    ...e.keptForRep.unplaced.map((text) => t('admin.questionnaireCopy.explain.keptUnplaced', { text })),
  ]
}
