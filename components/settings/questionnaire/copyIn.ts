/**
 * builderCopy in the interface language (Phase E5c). Display only: Hebrew
 * returns builderCopy's own constants / results (pinned by
 * questionnaireCopyPin.test.ts), every other language the same sentence from
 * the `admin.questionnaireCopy` catalog, keyed by the same codes. Nothing that
 * decides, stores or sends reads these. builderCopy itself is unchanged (the
 * phone view, Phase F, still reads it).
 */
import { formatLeadDateTime } from '@/lib/leads/leadDate'
import type { Translator } from '@/lib/i18n/translate'
import {
  ANSWER_TYPES,
  CONFLICT_COPY,
  FAILURE_COPY,
  PUBLISH_COPY,
  QUESTIONS_FULL,
  SAVE_STATUS,
  SIMULATE_COPY,
  TEXT_CHECKS,
  consequenceText,
  formatDateTime,
  isAnswering,
  liveStatusText,
  otherBlockedReason,
  publishConfirmText,
  type AnswerType,
  type LiveRouting,
  type TextCheck,
} from './builderCopy'

const he = (t: Translator) => t.locale === 'he'

export function questionsFullIn(t: Translator): string {
  return he(t) ? QUESTIONS_FULL : t('admin.questionnaireCopy.questionsFull')
}

export function otherBlockedReasonIn(state: { hasOther: boolean; optionsFull: boolean; questionsFull: boolean }, t: Translator): string | null {
  if (he(t)) return otherBlockedReason(state)
  if (state.hasOther) return null
  if (state.optionsFull) return t('admin.questionnaireCopy.otherNeedsRoom')
  if (state.questionsFull) return t('admin.questionnaireCopy.otherNeedsQuestion', { full: questionsFullIn(t) })
  return null
}

const ANSWER_KEYS = {
  single: { label: 'admin.questionnaireCopy.answerTypes.single.label', hint: 'admin.questionnaireCopy.answerTypes.single.hint' },
  multi: { label: 'admin.questionnaireCopy.answerTypes.multi.label', hint: 'admin.questionnaireCopy.answerTypes.multi.hint' },
  free: { label: 'admin.questionnaireCopy.answerTypes.free.label', hint: 'admin.questionnaireCopy.answerTypes.free.hint' },
} as const

/** ANSWER_TYPES with the words in the interface language: same values, same order. */
export function answerTypesIn(t: Translator): Array<{ value: AnswerType; label: string; hint: string }> {
  if (he(t)) return ANSWER_TYPES
  return ANSWER_TYPES.map((a) => ({ value: a.value, label: t(ANSWER_KEYS[a.value].label), hint: t(ANSWER_KEYS[a.value].hint) }))
}

const CHECK_KEYS = {
  none: { label: 'admin.questionnaireCopy.textChecks.none.label', hint: 'admin.questionnaireCopy.textChecks.none.hint' },
  date: { label: 'admin.questionnaireCopy.textChecks.date.label', hint: 'admin.questionnaireCopy.textChecks.date.hint' },
  meaningful: { label: 'admin.questionnaireCopy.textChecks.meaningful.label', hint: 'admin.questionnaireCopy.textChecks.meaningful.hint' },
  location: { label: 'admin.questionnaireCopy.textChecks.location.label', hint: 'admin.questionnaireCopy.textChecks.location.hint' },
} as const

/** TEXT_CHECKS with the words in the interface language: same values, same order. */
export function textChecksIn(t: Translator): Array<{ value: TextCheck; label: string; hint: string }> {
  if (he(t)) return TEXT_CHECKS
  return TEXT_CHECKS.map((c) => ({ value: c.value, label: t(CHECK_KEYS[c.value].label), hint: t(CHECK_KEYS[c.value].hint) }))
}

const SAVE_KEYS = { saving: 'admin.questionnaireCopy.save.saving', saved: 'admin.questionnaireCopy.save.saved', error: 'admin.questionnaireCopy.save.error' } as const

export function saveStatusIn(status: keyof typeof SAVE_STATUS, t: Translator): string {
  if (he(t) || status === 'idle') return SAVE_STATUS[status]
  return t(SAVE_KEYS[status])
}

const CONFLICT_KEYS = {
  changed_elsewhere: 'admin.questionnaireCopy.conflict.changedElsewhere',
  published_elsewhere: 'admin.questionnaireCopy.conflict.publishedElsewhere',
  gone: 'admin.questionnaireCopy.conflict.gone',
} as const

export function conflictIn(kind: keyof typeof CONFLICT_COPY, t: Translator): string {
  return he(t) ? CONFLICT_COPY[kind] : t(CONFLICT_KEYS[kind])
}

const FAILURE_KEYS: Record<string, 'admin.questionnaireCopy.failure.forbidden' | 'admin.questionnaireCopy.failure.historyMissing'> = {
  forbidden: 'admin.questionnaireCopy.failure.forbidden',
  history_missing: 'admin.questionnaireCopy.failure.historyMissing',
}

/** Why the draft could not be opened, or null for a reason without its own sentence. */
export function failureIn(reason: string, t: Translator): string | null {
  if (he(t)) return FAILURE_COPY[reason] ?? null
  return FAILURE_KEYS[reason] ? t(FAILURE_KEYS[reason]) : null
}

const PUBLISH_KEYS: Record<string, Parameters<Translator>[0]> = {
  not_ready: 'admin.questionnaireCopy.publish.notReady',
  invalid: 'admin.questionnaireCopy.publish.notReady',
  draft_out_of_date: 'admin.questionnaireCopy.publish.outOfDate',
  version_conflict: 'admin.questionnaireCopy.publish.versionConflict',
  forbidden: 'admin.questionnaireCopy.publish.forbidden',
}

/** A publish (or restore) refusal by code; an unknown code gets the general sentence. */
export function publishFailureIn(reason: string, t: Translator): string {
  if (he(t)) return PUBLISH_COPY[reason] ?? t('admin.questionnaireCopy.publish.fallback')
  return t(PUBLISH_KEYS[reason] ?? 'admin.questionnaireCopy.publish.fallback')
}

const SIMULATE_KEYS: Record<string, Parameters<Translator>[0]> = {
  not_ready: 'admin.questionnaireCopy.simulate.notReady',
  too_long: 'admin.questionnaireCopy.simulate.tooLong',
  not_found: 'admin.questionnaireCopy.simulate.notFound',
  forbidden: 'admin.questionnaireCopy.simulate.forbidden',
}

/** A test refusal by code, or null for a code without its own sentence. */
export function simulateFailureIn(reason: string, t: Translator): string | null {
  if (he(t)) return SIMULATE_COPY[reason] ?? null
  return SIMULATE_KEYS[reason] ? t(SIMULATE_KEYS[reason]) : null
}

export function consequenceTextIn(deps: { questions: string[]; endings: number[] }, t: Translator): string | null {
  if (he(t)) return consequenceText(deps)
  const parts: string[] = []
  const q = deps.questions.length
  const e = deps.endings.length
  if (q) parts.push(q === 1 ? t('admin.questionnaireCopy.consequence.questionOne') : t('admin.questionnaireCopy.consequence.questionMany', { count: String(q) }))
  if (e) parts.push(e === 1 ? t('admin.questionnaireCopy.consequence.endingOne') : t('admin.questionnaireCopy.consequence.endingMany', { count: String(e) }))
  return parts.length ? parts.join('\n') : null
}

export function liveStatusTextIn(liveRevision: number | null, routing: LiveRouting, t: Translator): string {
  if (he(t)) return liveStatusText(liveRevision, routing)
  if (liveRevision === null) return t('admin.questionnaireCopy.live.unpublished')
  const revision = String(liveRevision)
  if (isAnswering(routing)) return t('admin.questionnaireCopy.live.answering', { revision })
  if (routing.routedToQuestionnaire) return t('admin.questionnaireCopy.live.masterOff', { revision })
  return t('admin.questionnaireCopy.live.notRouted', { revision })
}

export function publishConfirmTextIn(revision: number, routing: LiveRouting, t: Translator): string {
  if (he(t)) return publishConfirmText(revision, routing)
  return t(isAnswering(routing) ? 'admin.questionnaireCopy.publishConfirm.answering' : 'admin.questionnaireCopy.publishConfirm.notAnswering', { revision: String(revision) })
}

/** A published version's date: builderCopy's Hebrew format, otherwise the leads' date-time format (BUSINESS_TZ). */
export function formatDateTimeIn(iso: string, t: Translator): string {
  return he(t) ? formatDateTime(iso) : formatLeadDateTime(t.locale, iso)
}

/** The release toasts (useQuestionnaireRelease): a version published, a draft made from a version. */
export function releaseToastIn(kind: 'published' | 'restored', revision: number, t: Translator): string {
  return kind === 'published'
    ? t('admin.questionnaire.toast.published', { revision: String(revision) })
    : t('admin.questionnaire.toast.restored', { revision: String(revision) })
}
