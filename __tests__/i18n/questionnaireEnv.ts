import { NOW } from './leadsFixtures'
import { ADMIN_USER } from './adminEnv'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

/**
 * Fixed data + mutable state behind the QUESTIONNAIRE BUILDER mocks (Phase
 * E5c): /settings/questionnaire on desktop — the list view, the Flow view, the
 * test chat, the version history, publishing. Used by the Hebrew baseline, the
 * leak gate, the locale and behaviour tests.
 *
 * The questionnaire itself (opening, questions, answers, phrasings, icons,
 * endings, the hand-off message, the summary title) is BUSINESS CONTENT, Hebrew
 * on purpose: it is what the business sends on WhatsApp and must reach the
 * screen untouched by any localization. Rep names in the history are data too.
 *
 * The `vi.mock` calls live in each test file; their factories read
 * `questionnaireEnv` / record into `questionnaireEnv.calls` (`questionnaireMocks.ts`).
 */
export { NOW }

const DAY = 24 * 3_600_000
const at = (ms: number) => new Date(ms).toISOString()

/** The draft being edited: a choice with "אחר" and its follow-up, a multi-select, a date, a custom ending. */
export const QUESTIONNAIRE: BuilderQuestionnaire = {
  opening: 'היי, תודה שפניתם לסטודיו דנה.',
  questions: [
    {
      id: 'event_type',
      label: 'סוג האירוע',
      prompt: 'איזה אירוע אתם מתכננים?',
      answer: {
        kind: 'single_choice',
        options: [
          { id: 'wedding', label: 'חתונה', icon: '💍', phrasings: ['אנחנו מתחתנים'] },
          { id: 'henna', label: 'חינה', phrasings: [] },
          { id: 'other', label: 'אחר', phrasings: ['משהו אחר'] },
        ],
      },
      shownWhen: { mode: 'always' },
      messages: {},
    },
    {
      id: 'other_details',
      label: 'פירוט האירוע',
      prompt: 'בשמחה, ספרו לנו בקצרה במה מדובר.',
      answer: { kind: 'text', notSetAllowed: false },
      shownWhen: { mode: 'all', conditions: [{ questionId: 'event_type', anyOf: ['other'] }] },
      messages: {},
    },
    {
      id: 'services',
      label: 'שירותים',
      prompt: 'אילו שירותים מעניינים אתכם?',
      answer: {
        kind: 'multi_choice',
        options: [
          { id: 'makeup', label: 'איפור', icon: '💄', phrasings: [] },
          { id: 'hair', label: 'שיער', phrasings: [] },
        ],
      },
      shownWhen: { mode: 'always' },
      messages: {},
    },
    {
      id: 'event_date',
      label: 'תאריך האירוע',
      prompt: 'מתי האירוע?',
      answer: { kind: 'date', notSetAllowed: true },
      shownWhen: { mode: 'always' },
      messages: {},
    },
  ],
  endings: {
    standard: 'מעולה, קיבלנו את הפרטים. נחזור אליכם בהקדם.',
    custom: [
      {
        sentWhen: { mode: 'all', conditions: [{ questionId: 'event_type', anyOf: ['wedding'] }] },
        message: 'מזל טוב! המחירון לחתונות: https://example.test/w',
      },
    ],
  },
  handoffMessage: 'תודה! העברנו את השיחה לצוות.',
  summaryTitle: 'שאלון וואטסאפ הושלם',
  settings: { attemptsBeforePerson: 2, abandonAfterHours: 24 },
}

/** An empty questionnaire (no questions): the Flow view's empty state. */
export const EMPTY_QUESTIONNAIRE: BuilderQuestionnaire = { ...QUESTIONNAIRE, questions: [], endings: { standard: QUESTIONNAIRE.endings.standard, custom: [] } }

export function draftOf(questionnaire: BuilderQuestionnaire, draftId = 9, draftVersion = 3, baseRevision: number | null = 2) {
  // Only what the editor reads: the model and the draft's identity (DraftState's derived `view` is not read here).
  return { draftId, draftVersion, baseRevision, updatedAt: at(NOW - DAY), questionnaire: structuredClone(questionnaire), view: {} as never, ready: true, issues: [] }
}

export const REVISIONS = [
  { revision: 2, publishedAt: at(NOW - 2 * DAY), publishedByName: 'דנה כהן', source: 'builder', activeSessions: 3 },
  { revision: 1, publishedAt: at(NOW - 20 * DAY), publishedByName: null, source: 'staff', activeSessions: 1 },
  { revision: 0, publishedAt: at(NOW - 40 * DAY), publishedByName: null, source: 'backfill', activeSessions: 0 },
]

const ROUTING = { hasSettings: true, routedToQuestionnaire: true, channelEnabled: true, masterEnabled: true }

export const QUESTIONNAIRE_DEFAULTS = {
  user: ADMIN_USER as typeof ADMIN_USER & Record<string, unknown>,
  hasAccess: true,
  builder: true,
  flow: true,
  allowAll: false,
  mobile: false,
  state: {
    published: { revision: 2, questionnaire: structuredClone(QUESTIONNAIRE) },
    draft: draftOf(QUESTIONNAIRE) as ReturnType<typeof draftOf> | null,
    live: ROUTING,
    activeSessionsByRevision: [],
  } as { published: { revision: number; questionnaire: BuilderQuestionnaire } | null; draft: ReturnType<typeof draftOf> | null; live: typeof ROUTING; activeSessionsByRevision: unknown[] },
  revisions: REVISIONS as Array<Record<string, unknown>>,
}

/** `active`: a questionnaire page is being built (the leak gate's shared mocks then answer from these fixtures). */
type Env = typeof QUESTIONNAIRE_DEFAULTS & { results: Record<string, unknown>; calls: unknown[][]; active: boolean }

export const questionnaireEnv: Env = { ...structuredClone(QUESTIONNAIRE_DEFAULTS), results: {}, calls: [], active: false }

export function resetQuestionnaireEnv() {
  Object.assign(questionnaireEnv, structuredClone(QUESTIONNAIRE_DEFAULTS), { results: {}, calls: [], active: false })
}

/** Business content and data rendered verbatim (the leak gate's allowances may only name these). */
export const QUESTIONNAIRE_CUSTOMER_DATA = ['דנה כהן']
