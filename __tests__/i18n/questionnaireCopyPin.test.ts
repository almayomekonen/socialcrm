import { describe, expect, test } from 'vitest'
import { translatorFor } from '@/lib/i18n/translators'
import * as copy from '@/components/settings/questionnaire/builderCopy'
import * as copyIn from '@/components/settings/questionnaire/copyIn'
import * as text from '@/components/settings/questionnaire/issueText'
import { describeIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/issues'
import { chosenSentence, describeCondition, questionName } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import { explainKept, explainReason, explainRecognized } from '@/lib/inbox/autoresponse/questionnaire/builder/explainText'
import { QUESTIONNAIRE } from './questionnaireEnv'

/**
 * The questionnaire builder's display mappings (Phase E5c) are display only:
 * in Hebrew every `…In` returns EXACTLY what the producer it shadows returns
 * (builderCopy, issues.ts, conditionText.ts, explainText.ts — none of them
 * changed), for every code; in English / Arabic every code has its own
 * sentence and the only Hebrew left is the business's own words, quoted.
 */
const he = translatorFor('he')
const LOCALES = [translatorFor('en'), translatorFor('ar')]
const m = QUESTIONNAIRE
const HEBREW = /[֐-׿]/
const BUSINESS = new RegExp(
  [...new Set(m.questions.flatMap((q) => [q.label, q.prompt, ...('options' in q.answer ? q.answer.options.flatMap((o) => [o.label, ...o.phrasings]) : [])]))]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'g',
)
/** The customer's own messages in the fixture explanation, then the questionnaire's words. */
const withoutBusiness = (s: string | null) => (s ?? '').replace(/טרם נקבע|בר מצווה|משהו|כמה זה עולה\?|בעצם חינה|תודה/g, '').replace(BUSINESS, '')

const routings = [true, false].flatMap((r) => [true, false].flatMap((c) => [true, false].map((ma) => ({ routedToQuestionnaire: r, channelEnabled: c, masterEnabled: ma }))))
const CODES = [
  'missing_text', 'too_long', 'no_questions', 'too_few_options', 'too_many_items', 'duplicate_option_label', 'phrasing_on_two_options',
  'condition_on_later_or_missing_question', 'condition_on_non_choice', 'condition_needs_answer', 'condition_on_deleted_option',
  'ending_condition_on_deleted_option', 'ending_condition_on_non_choice', 'ending_needs_one_condition', 'icon_invalid', 'message_too_long',
  'unreachable_question', 'other_without_follow_up', 'phrasing_is_command', 'phrasing_is_all', 'phrasing_is_filler',
  'conditions_more_than_one_not_supported_yet', 'messages_not_supported_for_choice', 'unknown_id', 'duplicate_id', 'brand_new_code',
]
const FIELDS = [undefined, 'opening', 'standardEnding', 'handoffMessage', 'summaryTitle', 'prompt', 'label', 'message', 'phrasings', 'icon', 'notUnderstood', 'askAgainAfterQuestion', 'other']
const issues = CODES.flatMap((code) =>
  FIELDS.flatMap((field) => [
    { code, severity: 'error', field },
    { code, severity: 'error', field, questionId: 'event_type' },
    { code, severity: 'error', field, questionId: 'event_type', optionId: 'wedding' },
    { code, severity: 'error', field, endingIndex: 0 },
    { code, severity: 'error', field, questionId: 'gone' },
  ]),
) as never[]
const REASONS = ['started', 'restarted', 'answered', 'completed', 'customer_question', 'customer_questions', 'early_messages', 'ignorable_only', 'human_request', 'declined', 'opt_out', 'invalid_limit', 'expired', 'session_closed', 'reprompt_invalid_choice', 'reprompt_invalid_multi', 'reprompt_invalid_text', 'reprompt_media', 'reprompt_voice', 'unknown']
const explanation = {
  reason: 'answered',
  recognized: [
    { questionId: 'event_type', optionIds: ['wedding'], fromWords: 'אנחנו מתחתנים' },
    { questionId: 'services', optionIds: ['makeup', 'gone'] },
    { questionId: 'event_date', notSet: true },
    { questionId: 'other_details', text: 'בר מצווה' },
    { questionId: 'missing', text: 'משהו' },
  ],
  keptForRep: { questions: ['כמה זה עולה?'], corrections: ['בעצם חינה'], unplaced: ['תודה'] },
} as never
const conditions = [null, ['event_type', ['wedding']], ['event_type', ['wedding', 'henna', 'other']], ['event_type', []], ['event_type', ['gone']], ['gone', ['x']]].map((c) =>
  c ? { questionId: c[0] as string, anyOf: c[1] as string[] } : null,
)

describe('Hebrew: every mapping returns the producer itself', () => {
  test('builderCopy', () => {
    expect(copyIn.questionsFullIn(he)).toBe(copy.QUESTIONS_FULL)
    expect(copyIn.answerTypesIn(he)).toBe(copy.ANSWER_TYPES)
    expect(copyIn.textChecksIn(he)).toBe(copy.TEXT_CHECKS)
    for (const hasOther of [true, false]) for (const optionsFull of [true, false]) for (const questionsFull of [true, false])
      expect(copyIn.otherBlockedReasonIn({ hasOther, optionsFull, questionsFull }, he)).toBe(copy.otherBlockedReason({ hasOther, optionsFull, questionsFull }))
    for (const s of ['idle', 'saving', 'saved', 'error'] as const) expect(copyIn.saveStatusIn(s, he)).toBe(copy.SAVE_STATUS[s])
    for (const k of ['changed_elsewhere', 'published_elsewhere', 'gone'] as const) expect(copyIn.conflictIn(k, he)).toBe(copy.CONFLICT_COPY[k])
    for (const r of ['forbidden', 'history_missing', 'x']) expect(copyIn.failureIn(r, he)).toBe(copy.FAILURE_COPY[r] ?? null)
    for (const r of ['not_ready', 'invalid', 'draft_out_of_date', 'version_conflict', 'forbidden', 'x']) expect(copyIn.publishFailureIn(r, he)).toBe(copy.PUBLISH_COPY[r] ?? 'הפרסום לא הצליח. נסו שוב.')
    for (const r of ['not_ready', 'too_long', 'not_found', 'forbidden', 'x']) expect(copyIn.simulateFailureIn(r, he)).toBe(copy.SIMULATE_COPY[r] ?? null)
    for (const q of [0, 1, 3]) for (const e of [0, 1, 2]) {
      const deps = { questions: Array.from({ length: q }, (_, i) => `q${i}`), endings: Array.from({ length: e }, (_, i) => i) }
      expect(copyIn.consequenceTextIn(deps, he)).toBe(copy.consequenceText(deps))
    }
    for (const rev of [null, 1, 12, 1234]) for (const r of routings) expect(copyIn.liveStatusTextIn(rev, r, he)).toBe(copy.liveStatusText(rev, r))
    for (const rev of [1, 1234]) for (const r of routings) expect(copyIn.publishConfirmTextIn(rev, r, he)).toBe(copy.publishConfirmText(rev, r))
    for (const iso of ['2026-10-28T09:05:00.000Z', '2026-03-27T23:30:00.000Z']) expect(copyIn.formatDateTimeIn(iso, he)).toBe(copy.formatDateTime(iso))
    expect([copyIn.releaseToastIn('published', 1234, he), copyIn.releaseToastIn('restored', 2, he)]).toEqual(['גרסה 1234 פורסמה', 'נוצרה טיוטה מגרסה 2'])
  })

  test('issues, card issues, conditions, question names, explanations', () => {
    for (const i of issues) {
      expect(text.issueTextIn(i, m, he)).toBe(describeIssue(i, m as never))
      expect(text.issueTextIn({ ...(i as object), text: 'כבר נוסח' } as never, m, he)).toBe('כבר נוסח')
      expect(text.cardIssueTextIn({ ...(i as object), text: 'כבר נוסח' } as never, m, he)).toBe(copy.cardIssueText({ ...(i as object), text: 'כבר נוסח' } as never))
    }
    for (const c of conditions) {
      expect(text.describeConditionIn(m, c, he)).toBe(describeCondition(m, c))
      expect(text.chosenSentenceIn(m, c, he)).toBe(chosenSentence(m, c))
    }
    for (const q of [{ label: 'סוג', prompt: 'איזה?' }, { label: ' ', prompt: 'איזה?' }, { label: '', prompt: '' }]) expect(text.questionNameIn(q, he)).toBe(questionName(q))
    for (const reason of REASONS) expect(text.explainReasonIn({ ...(explanation as object), reason } as never, he)).toBe(explainReason({ ...(explanation as object), reason } as never))
    expect(text.explainRecognizedIn(m, explanation, he)).toEqual(explainRecognized(m, explanation))
    expect(text.explainKeptIn(explanation, he)).toEqual(explainKept(explanation))
  })
})

describe('English / Arabic: a sentence per code, no Hebrew but the business\'s words', () => {
  for (const t of LOCALES) {
    test(t.locale, () => {
      const outputs = [
        copyIn.questionsFullIn(t),
        ...copyIn.answerTypesIn(t).flatMap((a) => [a.label, a.hint]),
        ...copyIn.textChecksIn(t).flatMap((a) => [a.label, a.hint]),
        copyIn.otherBlockedReasonIn({ hasOther: false, optionsFull: true, questionsFull: false }, t),
        copyIn.otherBlockedReasonIn({ hasOther: false, optionsFull: false, questionsFull: true }, t),
        ...(['saving', 'saved', 'error'] as const).map((s) => copyIn.saveStatusIn(s, t)),
        ...(['changed_elsewhere', 'published_elsewhere', 'gone'] as const).map((k) => copyIn.conflictIn(k, t)),
        copyIn.failureIn('forbidden', t), copyIn.failureIn('history_missing', t),
        ...['not_ready', 'draft_out_of_date', 'version_conflict', 'forbidden', 'x'].map((r) => copyIn.publishFailureIn(r, t)),
        ...['not_ready', 'too_long', 'not_found', 'forbidden'].map((r) => copyIn.simulateFailureIn(r, t)),
        copyIn.consequenceTextIn({ questions: ['a', 'b'], endings: [1] }, t),
        ...routings.map((r) => copyIn.liveStatusTextIn(3, r, t)), copyIn.liveStatusTextIn(null, routings[0], t),
        ...routings.map((r) => copyIn.publishConfirmTextIn(3, r, t)),
        copyIn.formatDateTimeIn('2026-10-28T09:05:00.000Z', t),
        ...issues.map((i) => text.issueTextIn(i, m, t)),
        ...conditions.flatMap((c) => [text.describeConditionIn(m, c, t), text.chosenSentenceIn(m, c, t)]),
        text.questionNameIn({ label: '', prompt: '' }, t),
        ...REASONS.map((reason) => text.explainReasonIn({ ...(explanation as object), reason } as never, t)),
        ...text.explainKeptIn(explanation, t),
      ]
      for (const o of outputs) expect(HEBREW.test(withoutBusiness(o)), `${t.locale}: ${o}`).toBe(false)
      // "not set" is the runtime's own recorded word, quoted as the rep's summary has it.
      expect(text.explainRecognizedIn(m, explanation, t).map(withoutBusiness).filter((l) => HEBREW.test(l))).toEqual([])
      const generic = text.issueTextIn({ code: 'brand_new_code', severity: 'error', questionId: 'event_type' } as never, m, t)
      for (const code of CODES.filter((c) => c !== 'brand_new_code')) expect(text.issueTextIn({ code, severity: 'error', questionId: 'event_type' } as never, m, t), code).not.toBe(generic)
    })
  }
})
