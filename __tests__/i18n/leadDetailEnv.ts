/**
 * Fixed data + mutable state behind the lead-detail mocks (`/clients/[clientId]`
 * layout + summary): the Hebrew baseline, the leak gate and the locale test.
 * Customer data is Hebrew on purpose — it must reach the screen untouched by
 * any localization, so the tests prove it does. External content (Meta form
 * questions and answers, ad names, WhatsApp template bodies, AI output) is
 * fixture data of its own kind and is listed separately.
 */
import { NOW } from './leadsFixtures'

export { NOW }

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()

export const DETAIL_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

/** The layout's `getFullLead` read (header). `birthDate` is a Date, as knex returns it. */
export const HEADER_LEAD = {
  name: 'יוסי לוי',
  rank: null,
  birthDate: new Date('1990-05-01T00:00:00Z'),
  gender: 'זכר',
  familyStatus: null,
  email: 'yossi@example.test',
  phone: '0501234567',
  secPhone: null,
  handlerId: 12,
}

/** The summary page's `getFullLead` read. */
export const SUMMARY_LEAD = {
  status: 'contacted',
  nextFollowUpAt: at(NOW + 2 * DAY),
  followUpNote: 'לחזור אחרי החג',
  lastOutcomeType: 'call_reached',
  lastActivityAt: at(NOW - DAY),
  leadSource: 'manual',
  createdAt: at(NOW - 3 * DAY),
  firstName: 'יוסי',
  lastName: 'לוי',
  phone: '0501234567',
  email: 'yossi@example.test',
}

export const FAMILY = [
  { id: 41, name: 'יוסי לוי' },
  { id: 42, name: 'רחל לוי' },
]

export const TASKS = [
  { id: 1, title: 'לשלוח הצעת מחיר', dueDate: at(NOW + DAY) },
  { id: 2, title: 'שיחת המשך', dueDate: at(NOW - 2 * DAY) },
]

/** Meta Lead Ads answers — external text, never translated. One standard key, one custom question. */
export const FORM_ANSWERS = [
  { key: 'full_name', values: ['יוסי לוי'] },
  { key: 'city', values: ['חיפה'] },
  { key: 'מה_התקציב_שלך?', values: ['עד 5,000'] },
  { key: 'when_do_you_want_to_start?', values: [] as string[] },
]

export const WA_PREVIEW = 'היי, ראיתי את המודעה ואשמח לפרטים'

export const ATTRIBUTION = {
  campaignId: '1200001',
  campaignName: 'קמפיין חורף',
  adsetName: 'קהל חם',
  adId: '1200003',
  adName: 'מודעת וידאו',
  formId: '77',
  platform: 'ig',
  isOrganic: false,
}

export const TEMPLATES = [
  {
    id: 501,
    displayTitle: 'תזכורת פגישה',
    status: 'approved',
    bodyText: 'שלום {{1}}, מזכירים את הפגישה מחר',
    variables: [{ token: '{{1}}', sample: 'יוסי' }],
    failureText: null,
    archived: false,
    createdAt: at(NOW - 30 * DAY),
  },
]

/** AI output — stays exactly as generated (decision D3). `sources` are the fixed category values. */
export const INTELLIGENCE = {
  summary: 'הליד ביקש הצעת מחיר ולא חזר מאז השיחה האחרונה.',
  keyInsights: ['מתעניין בחבילה השנתית', 'רגיש למחיר'],
  suggestedNextAction: { title: 'להתקשר ולהציע הנחה', reason: 'עברו יומיים מאז השיחה' },
  sources: ['סטטוס הליד', 'פעילות אחרונה'],
  confidence: 'medium' as 'low' | 'medium' | 'high',
}

export type IntelligenceResult = { ok: true; data: typeof INTELLIGENCE } | { ok: false; reason: string }

export const DETAIL_DEFAULTS = {
  pathname: '/clients/41/summary',
  search: '',
  header: HEADER_LEAD as Record<string, unknown> | null,
  lead: SUMMARY_LEAD as Record<string, unknown> | null,
  family: [] as { id: number; name: string }[],
  handlerName: 'מנהל ראשי' as string | null,
  tasks: TASKS as { id: number; title: string; dueDate: string }[],
  /** WhatsApp inbound: the linked conversation (null = none) and its messages. */
  conversationId: 900 as number | null,
  messages: [
    { direction: 'outbound', text: 'שלום' },
    { direction: 'inbound', text: WA_PREVIEW },
  ] as { direction: string; text: string }[],
  formAnswers: FORM_ANSWERS as { key: string; values: string[] }[],
  attribution: null as Record<string, unknown> | null,
  creative: null as { payload: { imageUrl?: string } } | null,
  adsReporting: true,
  templatesEnabled: true,
  templates: TEMPLATES as Record<string, unknown>[],
  reachable: true,
  /** Product access on the server (`getAgencyProductAccess`) and on the client (EntitlementProvider). */
  hasAccess: true,
  intelligence: { ok: true, data: INTELLIGENCE } as IntelligenceResult,
}

export const detailEnv = { ...DETAIL_DEFAULTS }

export function resetDetailEnv() {
  Object.assign(detailEnv, DETAIL_DEFAULTS)
}

/** Fixed entitlement states for the expired variants. */
export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T12:00:00.000Z' }
export const NEVER_STARTED = { hasAccess: false, status: 'NEVER_STARTED', expiresAt: null }
export const ACTIVE = { hasAccess: true, status: 'ACTIVE', expiresAt: null }

/** Hebrew customer data the detail screens render verbatim (names, notes, tasks, emails). */
export const DETAIL_CUSTOMER_DATA = [
  HEADER_LEAD.name,
  HEADER_LEAD.gender,
  SUMMARY_LEAD.followUpNote,
  ...FAMILY.map((f) => f.name),
  ...TASKS.map((t) => t.title),
  'מנהל ראשי',
  'דנה כהן',
]

/** Third-party text rendered verbatim: Meta form answers/questions and ad names, WhatsApp, templates, AI. */
export const DETAIL_EXTERNAL = [
  'חיפה',
  'מה התקציב שלך?',
  'עד 5,000',
  WA_PREVIEW,
  ATTRIBUTION.campaignName,
  ATTRIBUTION.adsetName,
  ATTRIBUTION.adName,
  TEMPLATES[0].displayTitle,
  TEMPLATES[0].bodyText,
  INTELLIGENCE.summary,
  ...INTELLIGENCE.keyInsights,
  INTELLIGENCE.suggestedNextAction.title,
  INTELLIGENCE.suggestedNextAction.reason,
]
