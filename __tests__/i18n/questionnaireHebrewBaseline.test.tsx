// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EMPTY_QUESTIONNAIRE, NOW, QUESTIONNAIRE, draftOf, questionnaireEnv, resetQuestionnaireEnv } from './questionnaireEnv'
import { EXPIRED, questionnairePage, questionnaireShell, questionnaireTitle } from './questionnaireHarness'

/**
 * HEBREW BASELINE for the questionnaire builder (Phase E5c) — server HTML of
 * every page-level state of /settings/questionnaire, the tab title, the 404
 * gates, and a JSON snapshot of every label producer the builder shows.
 * Recorded BEFORE Phase E5c on unmodified product code.
 * (Interactions: questionnaireHebrewBaselineInteractions / …Flow.)
 *
 * Real server page inside the real (admin_settings) layout, I/O mocked, no
 * i18n provider. Normalized: `<!-- -->` separators and `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./questionnaireMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('@/db/auth', async () => (await import('./questionnaireMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./questionnaireMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./questionnaireMocks')).deviceModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./questionnaireMocks')).builderFlagsModule())
vi.mock('@/lib/flags/whatsappQuestionnaireFlags', async () => (await import('./questionnaireMocks')).naturalAnswersFlagsModule())
vi.mock('@/lib/inbox/autoresponse/questionnaire/builder/service', async () => (await import('./questionnaireMocks')).serviceModule())
vi.mock('@/actions/questionnaire/builderDraft', async () => (await import('./questionnaireMocks')).draftActionsModule())
vi.mock('@/actions/questionnaire/builderPublish', async () => (await import('./questionnaireMocks')).publishActionsModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof questionnaireEnv>) => Object.assign(questionnaireEnv, overrides)
const live = (routedToQuestionnaire: boolean, channelEnabled = true, masterEnabled = true) => ({ hasSettings: true, routedToQuestionnaire, channelEnabled, masterEnabled })
const html = async (ent?: typeof EXPIRED) => {
  try {
    return renderToString(await questionnaireShell(null, await questionnairePage(), ent))
  } catch (e) {
    return `THROWN: ${(e as Error).message}`
  }
}

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetQuestionnaireEnv()
})

describe('Hebrew baseline — questionnaire builder (server HTML)', () => {
  test('page states: Flow view, list view, natural answers, no draft, unpublished, routing states, empty, expired, phone, 404 gates', async () => {
    const out: Record<string, unknown> = {}
    out.title = await questionnaireTitle()
    out.flow = await html()
    set({ flow: false })
    out.list = await html()
    set({ allowAll: true })
    out.listAllowAll = await html()
    set({ allowAll: false, state: { ...questionnaireEnv.state, draft: null } })
    out.noDraft = await html()
    set({ state: { ...questionnaireEnv.state, draft: draftOf(QUESTIONNAIRE, 9, 1, null), published: null, live: live(false, false, false) } })
    out.unpublished = await html()
    set({ state: { ...questionnaireEnv.state, draft: draftOf(QUESTIONNAIRE), published: { revision: 2, questionnaire: QUESTIONNAIRE }, live: live(false) } })
    out.notRouted = await html()
    set({ state: { ...questionnaireEnv.state, live: live(true, true, false) } })
    out.masterOff = await html()
    set({ state: { ...questionnaireEnv.state, draft: draftOf(EMPTY_QUESTIONNAIRE), live: live(true) } })
    out.emptyList = await html()
    set({ flow: true })
    out.emptyFlow = await html()
    set({ hasAccess: false })
    out.expired = await html(EXPIRED)
    set({ hasAccess: true, mobile: true, state: { ...questionnaireEnv.state, draft: draftOf(QUESTIONNAIRE) } })
    out.phone = await html()
    set({ mobile: false, builder: false })
    out.notInRollout = await html()
    set({ builder: true, user: { ...questionnaireEnv.user, role: 'AGNT' } })
    out.notAdmin = await html()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — questionnaire label producers (JSON)', () => {
  test('builderCopy, issues, conditions, explanations', async () => {
    const copy = await import('@/components/settings/questionnaire/builderCopy')
    const { describeIssue } = await import('@/lib/inbox/autoresponse/questionnaire/builder/issues')
    const { describeCondition, chosenSentence, questionName } = await import('@/lib/inbox/autoresponse/questionnaire/builder/conditionText')
    const ex = await import('@/lib/inbox/autoresponse/questionnaire/builder/explainText')
    const m = QUESTIONNAIRE
    const routings = [live(true), live(true, true, false), live(false), live(true, false, true)]
    const CODES = [
      'missing_text', 'too_long', 'no_questions', 'too_few_options', 'too_many_items', 'duplicate_option_label', 'phrasing_on_two_options',
      'condition_on_later_or_missing_question', 'condition_on_non_choice', 'condition_needs_answer', 'condition_on_deleted_option',
      'ending_condition_on_deleted_option', 'ending_condition_on_non_choice', 'ending_needs_one_condition', 'icon_invalid', 'message_too_long',
      'unreachable_question', 'other_without_follow_up', 'phrasing_is_command', 'phrasing_is_all', 'phrasing_is_filler',
      'conditions_more_than_one_not_supported_yet', 'messages_not_supported_for_choice', 'unknown_id', 'duplicate_id', 'something_new',
    ]
    const FIELDS = [undefined, 'opening', 'standardEnding', 'handoffMessage', 'summaryTitle', 'prompt', 'label', 'message', 'phrasings', 'icon', 'notUnderstood', 'askAgainAfterQuestion', 'unknown']
    const issues: Record<string, unknown> = {}
    for (const code of CODES) {
      for (const scope of ['questionnaire', 'question', 'option', 'ending'] as const) {
        const base = { code, severity: 'error' } as Record<string, unknown>
        if (scope !== 'questionnaire') base.questionId = 'event_type'
        if (scope === 'option') base.optionId = 'wedding'
        if (scope === 'ending') base.endingIndex = 0
        issues[`${code}/${scope}`] = describeIssue(base as never, m as never)
      }
    }
    for (const field of FIELDS) {
      issues[`missing_text/field:${field}`] = describeIssue({ code: 'missing_text', severity: 'error', field, questionId: 'services' } as never, m as never)
      issues[`too_long/field:${field}`] = describeIssue({ code: 'too_long', severity: 'error', field } as never, m as never)
    }
    issues.unnamed = describeIssue({ code: 'too_few_options', severity: 'error', questionId: 'x' } as never, { ...m, questions: [{ ...m.questions[0], id: 'x', prompt: '', label: '' }] } as never)
    const cond = (questionId: string, anyOf: string[]) => ({ questionId, anyOf })
    const REASONS = ['started', 'restarted', 'answered', 'completed', 'customer_question', 'customer_questions', 'early_messages', 'ignorable_only', 'human_request', 'declined', 'opt_out', 'invalid_limit', 'expired', 'session_closed', 'reprompt_invalid_choice', 'reprompt_invalid_multi', 'reprompt_invalid_text', 'reprompt_media', 'reprompt_voice', 'unknown_reason']
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
    }
    const out = {
      constants: {
        QUESTIONS_FULL: copy.QUESTIONS_FULL,
        ANSWER_TYPES: copy.ANSWER_TYPES,
        TEXT_CHECKS: copy.TEXT_CHECKS,
        LOCATION_PRESET: copy.LOCATION_PRESET,
        DATE_PRESET: copy.DATE_PRESET,
        SAVE_STATUS: copy.SAVE_STATUS,
        CONFLICT_COPY: copy.CONFLICT_COPY,
        FAILURE_COPY: copy.FAILURE_COPY,
        PUBLISH_COPY: copy.PUBLISH_COPY,
        SIMULATE_COPY: copy.SIMULATE_COPY,
      },
      otherBlocked: [
        copy.otherBlockedReason({ hasOther: true, optionsFull: true, questionsFull: true }),
        copy.otherBlockedReason({ hasOther: false, optionsFull: true, questionsFull: true }),
        copy.otherBlockedReason({ hasOther: false, optionsFull: false, questionsFull: true }),
        copy.otherBlockedReason({ hasOther: false, optionsFull: false, questionsFull: false }),
      ],
      answerTypeOf: (['single_choice', 'multi_choice', 'text', 'date', 'text_unchecked'] as const).map((k) => [copy.answerTypeOf(k), copy.textCheckOf(k)]),
      formatDateTime: [copy.formatDateTime('2026-10-28T09:05:00.000Z'), copy.formatDateTime('2026-01-01T22:30:00.000Z')],
      consequence: [
        copy.consequenceText({ questions: [], endings: [] }),
        copy.consequenceText({ questions: ['a'], endings: [] }),
        copy.consequenceText({ questions: ['a', 'b'], endings: [1] }),
        copy.consequenceText({ questions: [], endings: [1, 2] }),
      ],
      liveStatus: [copy.liveStatusText(null, live(false)), ...routings.map((r) => copy.liveStatusText(4, r))],
      publishConfirm: routings.map((r) => copy.publishConfirmText(5, r)),
      cardIssue: [
        copy.cardIssueText({ code: 'missing_text', field: 'prompt', text: 'x' }),
        copy.cardIssueText({ code: 'missing_text', field: 'label', text: 'x' }),
        copy.cardIssueText({ code: 'too_long', field: 'prompt', text: 'מלא' }),
      ],
      rows: [copy.rowsFor(''), copy.rowsFor('a\nb\nc', 3), copy.rowsFor('a\n'.repeat(20))],
      issues,
      conditions: {
        none: describeCondition(m as never, null),
        one: describeCondition(m as never, cond('event_type', ['wedding'])),
        two: describeCondition(m as never, cond('event_type', ['wedding', 'henna'])),
        three: describeCondition(m as never, cond('event_type', ['wedding', 'henna', 'other'])),
        empty: describeCondition(m as never, cond('event_type', [])),
        deletedOption: describeCondition(m as never, cond('event_type', ['gone'])),
        deletedQuestion: describeCondition(m as never, cond('gone', ['wedding'])),
        chosen: [chosenSentence(m as never, cond('event_type', ['wedding', 'henna'])), chosenSentence(m as never, cond('event_type', [])), chosenSentence(m as never, cond('gone', ['x'])), chosenSentence(m as never, null)],
        names: [questionName({ label: 'סוג', prompt: 'איזה?' }), questionName({ label: ' ', prompt: 'איזה?' }), questionName({ label: '', prompt: '' })],
      },
      explain: {
        reasons: REASONS.map((reason) => ex.explainReason({ ...explanation, reason } as never)),
        recognized: ex.explainRecognized(m as never, explanation as never),
        kept: ex.explainKept(explanation as never),
      },
    }
    expect(JSON.parse(JSON.stringify(out))).toMatchSnapshot()
  })
})
