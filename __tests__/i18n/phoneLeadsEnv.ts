/**
 * Mutable fixtures for the phone leads tests (i18n Phase F2): the phone lead
 * list (`/leads` on a phone), the phone lead detail (`/clients/[id]/summary` on
 * a phone) and their sheets. Names, phones, notes and the AI summary are
 * Hebrew customer data / AI output on purpose — the tests prove they reach the
 * screen untouched. Each test file wires its `vi.mock` factories to this
 * object (phoneLeadsMocks.ts); `resetPhoneEnv()` restores it.
 */

export const NOW = Date.parse('2026-10-30T09:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

export const PHONE_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

type Row = {
  id: number
  name: string
  phone: string | null
  waPhone: string | null
  email: string | null
  status: string | null
  sourceLabel: string
  sourceChannel: string | null
  nextFollowUpAt: string | null
  lastActivityAt: string | null
  createdAt: string | null
  nextAction: string | null
  severity: number | null
  isNewBadge: boolean
  handlerName: string | null
}

const row = (r: Partial<Row> & Pick<Row, 'id' | 'name'>): Row => ({
  phone: '0521234567',
  waPhone: '972521234567',
  email: null,
  status: 'new',
  sourceLabel: 'ידני',
  sourceChannel: 'manual',
  nextFollowUpAt: null,
  lastActivityAt: null,
  createdAt: at(NOW - 3 * DAY),
  nextAction: null,
  severity: null,
  isNewBadge: false,
  handlerName: null,
  ...r,
})

/** Every card shape: each status, both follow-up badges, the long-wait line, the next-action line, every recency bucket. */
export const LIST_ROWS: Row[] = [
  row({ id: 11, name: 'יוסי אברהם', status: 'new', isNewBadge: true, nextAction: 'התקשר עכשיו', lastActivityAt: at(NOW - 20_000) }),
  row({ id: 12, name: 'מיכל לוי', status: 'contacted', nextAction: 'עקוב אחרי', nextFollowUpAt: at(NOW - DAY), lastActivityAt: at(NOW - 4 * MIN) }),
  row({ id: 13, name: 'אבי כהן', status: 'interested', nextAction: 'סגור עסקה', nextFollowUpAt: at(NOW + 2 * HOUR), lastActivityAt: at(NOW - 5 * HOUR) }),
  row({ id: 14, name: 'רונית שמש', status: 'new', severity: 2, nextAction: 'התקשר עכשיו', lastActivityAt: at(NOW - 30 * HOUR) }),
  row({ id: 15, name: 'שרון דוד', status: 'closed', phone: null, waPhone: '972541112222', lastActivityAt: at(NOW - 3 * DAY) }),
  row({ id: 16, name: 'גלית מזרחי', status: 'lost', phone: null, waPhone: null, lastActivityAt: null, createdAt: at(Date.parse('2026-10-14T12:00:00Z')) }),
]

/** A second batch, for "טען עוד". */
export const MORE_ROWS: Row[] = [
  row({ id: 21, name: 'נועה ברק', status: 'contacted', nextAction: 'עקוב אחרי', lastActivityAt: at(NOW - 2 * HOUR) }),
]

export type Detail = Row & {
  followUpNote: string | null
  lastOutcomeType: string | null
  leadSource: string | null
  secPhone: string | null
  firstName: string | null
  lastName: string | null
}

export const DETAIL: Detail = {
  ...row({
    id: 41,
    name: 'יוסי אברהם',
    email: 'yossi@example.com',
    status: 'contacted',
    nextFollowUpAt: at(NOW - DAY),
    lastActivityAt: at(NOW - 2 * DAY),
    sourceLabel: 'ידני',
  }),
  followUpNote: 'לחזור אחרי החג',
  lastOutcomeType: 'call_reached',
  leadSource: 'ידני',
  secPhone: '0539876543',
  firstName: 'יוסי',
  lastName: 'אברהם',
}

/** The provenance card for each source: Facebook / WhatsApp (with a conversation) / import / website / unknown. */
export const SOURCE_DETAILS: Record<string, Partial<Detail>> = {
  facebook: { leadSource: 'facebook:1203', sourceLabel: 'Facebook', sourceChannel: 'facebook' },
  instagram: { leadSource: 'instagram:88', sourceLabel: 'Instagram', sourceChannel: 'instagram' },
  whatsapp: { leadSource: 'whatsapp:972521234567', sourceLabel: 'WhatsApp', sourceChannel: 'whatsapp' },
  import: { leadSource: 'ייבוא', sourceLabel: 'ייבוא', sourceChannel: null },
  website: { leadSource: 'אתר', sourceLabel: 'אתר', sourceChannel: 'website' },
}

export const INTELLIGENCE = {
  summary: 'הליד ביקש הצעת מחיר ולא חזר מאז השיחה האחרונה.',
  keyInsights: ['מתעניין בחבילה השנתית'],
  suggestedNextAction: { title: 'להתקשר ולהציע הנחה', reason: 'עברו יומיים מאז השיחה' },
  sources: ['סטטוס הליד'],
  confidence: 'medium' as const,
}

export const ACTIVE = { hasAccess: true, status: 'ACTIVE', expiresAt: null }
export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T12:00:00.000Z' }

const DEFAULTS = {
  rows: LIST_ROWS as Row[],
  hasMore: false,
  workspaceHasLeads: true,
  waConnected: true,
  meta: { connected: false, needsReconnect: false },
  detail: DETAIL as Detail | null,
  waPreview: { conversationId: 9, preview: 'היי, אשמח לפרטים על המבצע' },
  formAnswers: [] as { key: string; values: string[] }[],
  userLocale: null as string | null,
}

export const phoneEnv = {
  ...structuredClone(DEFAULTS),
  /** Recorded action / toast calls, `[name, ...args]`. */
  calls: [] as unknown[][],
  /** Per-action answers: a value, `'throw'`, or unset for the success shape. */
  results: {} as Record<string, unknown>,
}

export function resetPhoneEnv() {
  Object.assign(phoneEnv, structuredClone(DEFAULTS), { calls: [], results: {} })
}

/** Every Hebrew value the phone lead screens show verbatim (leak-gate allowances come from here). */
export const PHONE_CUSTOMER_DATA = [
  ...LIST_ROWS.map((r) => r.name),
  ...MORE_ROWS.map((r) => r.name),
  DETAIL.followUpNote as string,
  'היי, אשמח לפרטים על המבצע',
]
