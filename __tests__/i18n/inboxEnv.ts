/**
 * Fixed data + mutable state behind the WhatsApp INBOX mocks (`/inbox`, desktop):
 * the Hebrew baseline, the leak gate, the locale and behaviour tests.
 *
 * Customer data is Hebrew on purpose (names, message bodies, captions, file
 * names, AI text, handoff answers): it must reach the screen untouched by any
 * localization. List rows are RAW query rows; the mocked queries run them
 * through the REAL `mapInboxRow`, so the waiting copy is produced exactly as in
 * production.
 */
import { failureTextForCategory } from '@/lib/inbox/whatsappErrorCopy'
import { NOW } from './leadsFixtures'

export { NOW }

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

export const INBOX_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

const row = (id: number, extra: Record<string, unknown>) => ({
  conversationId: id,
  leadId: 40 + id,
  channel: 'whatsapp',
  customerName: null,
  leadName: null,
  customerWaId: `97250000000${id}`,
  leadStatus: 'new',
  lastMessageAt: at(NOW - id * HOUR),
  lastInboundAt: null,
  lastHumanOutboundAt: null,
  lastDirection: 'inbound',
  lastMessageText: null,
  lastReadAt: null,
  temperature: null,
  intent: null,
  suggestedAction: null,
  ...extra,
})

/**
 * Raw list rows: waiting + window open + unread + hot; waiting + window closed;
 * replied (outbound last); a leadless contact known only by number; an ensured
 * thread with no message yet; an unknown intelligence value (hidden).
 */
export const LIST_ROWS = [
  row(1, {
    customerName: 'יוסי לוי',
    leadName: 'יוסי לוי',
    lastMessageAt: at(NOW - 2 * HOUR),
    lastInboundAt: at(NOW - 2 * HOUR),
    lastMessageText: 'כמה עולה החבילה השנתית?',
    temperature: 'hot',
    intent: 'pricing',
    suggestedAction: 'send_quote',
  }),
  row(2, {
    customerName: 'רונית כהן',
    leadName: 'רונית כהן',
    lastMessageAt: at(NOW - 30 * HOUR),
    lastInboundAt: at(NOW - 30 * HOUR),
    lastReadAt: at(NOW - 29 * HOUR),
    lastMessageText: 'אפשר לקבוע הדגמה ביום שלישי?',
    temperature: 'warm',
    intent: 'demo',
    suggestedAction: 'schedule_demo',
  }),
  row(3, {
    leadName: 'משה אברהם',
    lastMessageAt: at(NOW - 3 * HOUR),
    lastInboundAt: at(NOW - 5 * HOUR),
    lastHumanOutboundAt: at(NOW - 3 * HOUR),
    lastReadAt: at(NOW - 4 * HOUR),
    lastDirection: 'outbound',
    lastMessageText: 'שלחתי לך את ההצעה במייל',
    temperature: 'cold',
    intent: 'support',
    suggestedAction: 'escalate_support',
  }),
  row(4, {
    leadId: null,
    lastMessageAt: at(NOW - 40 * MIN),
    lastInboundAt: at(NOW - 40 * MIN),
    lastMessageText: 'היי, ראיתי את המודעה',
    intent: 'information',
    suggestedAction: 'follow_up',
  }),
  row(5, {
    customerName: 'שרה מזרחי',
    leadName: 'שרה מזרחי',
    lastMessageAt: null,
    lastDirection: null,
    intent: 'other',
    suggestedAction: 'none',
  }),
]

export const SMART_COUNTS = { hot: 3, attention: 1, demo: 2, escalation: 0 }

type Msg = Record<string, unknown>
const msg = (id: number, minutesAgo: number, extra: Msg): Msg => ({
  id,
  direction: 'inbound',
  type: 'text',
  text: '',
  timestamp: at(NOW - minutesAgo * MIN),
  status: 'received',
  failureText: null,
  failureCategory: null,
  attachment: null,
  ...extra,
})
const failed = (id: number, minutesAgo: number, text: string, category: string): Msg =>
  msg(id, minutesAgo, {
    direction: 'outbound',
    text,
    status: 'failed',
    failureCategory: category,
    failureText: failureTextForCategory(category),
    byPerson: true,
  })

/**
 * One thread with every bubble the inbox draws: inbound/outbound text, every
 * delivery status and failure category, image (with and without caption),
 * document, audio, an unsupported type, an attached reaction, an orphan
 * reaction, quoted replies (found / not found / to a photo), across two days.
 */
export const THREAD = [
  msg(101, 26 * 60, { text: 'שלום, אני מתעניין בשירות שלכם' }),
  msg(102, 26 * 60 - 5, { direction: 'outbound', text: 'היי יוסי! איך אפשר לעזור?', status: 'read', byPerson: true }),
  msg(103, 26 * 60 - 10, { type: 'image', attachment: { filename: null, mimeType: 'image/jpeg' } }),
  msg(104, 26 * 60 - 12, { type: 'image', caption: 'זה המוצר שראיתי', attachment: { filename: 'מוצר.jpg', mimeType: 'image/png' } }),
  msg(105, 3 * 60, { type: 'document', attachment: { filename: 'מפרט_טכני.pdf', mimeType: 'application/pdf' } }),
  msg(106, 3 * 60 - 1, { type: 'document', attachment: { filename: null, mimeType: 'application/zip' } }),
  msg(107, 3 * 60 - 2, { type: 'audio', attachment: { filename: null, mimeType: 'audio/ogg' } }),
  msg(108, 3 * 60 - 3, { type: 'sticker' }),
  msg(109, 3 * 60 - 4, { type: 'reaction', reaction: { emoji: '👍', targetId: 102, targetRef: 'a1' } }),
  msg(110, 3 * 60 - 5, { type: 'reaction', reaction: { emoji: '❤️', targetId: null, targetRef: 'zz' } }),
  msg(111, 2 * 60 + 30, { direction: 'outbound', type: 'reaction', reaction: { emoji: '🙏', targetId: 101, targetRef: 'b2' } }),
  msg(112, 2 * 60 + 20, { text: 'אז מה המחיר?', replyTo: { targetId: 102 } }),
  msg(113, 2 * 60 + 10, { text: 'ועל זה?', replyTo: { targetId: null } }),
  msg(114, 2 * 60 + 5, { text: 'והתמונה?', replyTo: { targetId: 103 } }),
  msg(115, 2 * 60, { direction: 'outbound', text: 'המחיר 1,200 ₪ לשנה', status: 'sent', byPerson: true }),
  msg(116, 110, { direction: 'outbound', text: 'נשלח גם קטלוג', status: 'delivered', byPerson: true }),
  failed(117, 100, 'ניסיתי לשלוח שוב', 'window_expired'),
  failed(118, 95, 'הודעה למספר', 'recipient'),
  failed(119, 90, 'הודעה מהחשבון', 'account'),
  failed(120, 85, 'הודעה כללית', 'generic'),
  msg(121, 80, { text: 'תודה, אחשוב על זה https://example.test/info' }),
]

/**
 * Message bodies / captions / file names exactly as stored — never translated.
 * A body with a link renders as text + anchor, so it is listed as its text
 * around the link (the same characters, split as the linkifier splits them).
 */
export const THREAD_CONTENT = THREAD.flatMap((m) => [
  ...(typeof m.text === 'string' ? m.text.split(/\s*https?:\S+/) : []),
  m.caption,
  (m.attachment as { filename?: string } | null)?.filename,
]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

/** A thread whose latest inbound is 30h old: the 24h window is closed. */
export const CLOSED_THREAD = [
  msg(201, 30 * 60, { text: 'אשמח לפרטים' }),
  msg(202, 29 * 60, { direction: 'outbound', text: 'שלחתי', status: 'read', byPerson: true }),
]

/** Only outbound: the customer never wrote, so the window is unknown. */
export const UNKNOWN_THREAD = [msg(301, 60, { direction: 'outbound', text: 'הודעה ראשונה מאיתנו', status: 'delivered', byPerson: true })]

export const TEMPLATES = [
  {
    id: 11,
    displayTitle: 'תזכורת פגישה',
    status: 'approved',
    bodyText: 'שלום {{1}}, מזכירים את הפגישה מחר',
    variables: [],
    failureText: null,
    archived: false,
    createdAt: at(NOW - 10 * DAY),
  },
]

export const HANDOFF = {
  name: 'יוסי לוי',
  businessType: 'מספרה',
  need: 'רוצה לשמוע על החבילה השנתית',
  urgency: 'גבוהה',
  temperature: 'hot',
  fields: null as Array<{ label: string; value: string }> | null,
}

export const QUESTIONNAIRE_FIELDS = [
  { label: 'מה שם העסק?', value: 'מספרת רון' },
  { label: 'כמה סניפים?', value: '2' },
]

const intel = (kind: string, data: unknown, status = 'fresh', confidence: string | null = null) => ({
  kind,
  data,
  status,
  coveredSequence: 5,
  analyzerVersion: 'v4',
  modelId: 'm',
  confidence,
  updatedAt: at(NOW - 30 * MIN),
  lastError: null,
})

export const AI_SUMMARY = 'הלקוח שואל על מחיר החבילה השנתית ומבקש פרטים.'
export const AI_ACTION_REASON = 'הלקוח שאל פעמיים על המחיר.'

export function intelView(state: 'none' | 'pending' | 'fresh' | 'stale' | 'failed') {
  if (state === 'none') return { items: [], jobPending: false, jobStatus: null }
  if (state === 'pending') return { items: [], jobPending: true, jobStatus: 'pending' }
  const s = state === 'failed' ? 'failed' : state
  return {
    items: [
      intel('summary', { summary: AI_SUMMARY }, s),
      intel('intent', { intent: 'pricing' }, s),
      intel('temperature', { temperature: 'hot' }, s),
      intel('suggested_action', { suggestedAction: 'send_quote', reason: AI_ACTION_REASON }, s, 'high'),
    ],
    jobPending: false,
    jobStatus: 'done',
  }
}

export const OPERATOR_TAKE = {
  data: {
    suggestedAction: 'send_quote',
    reason: 'הלקוח שאל על המחיר פעמיים',
    actionMessage: 'כדאי לשלוח הצעת מחיר עם הנחת השקה',
    noveltyKind: 'opportunity',
    sourceMessageIds: [112],
  },
  status: 'fresh',
  coveredSequence: 9,
  promptVersion: 'v4',
}

export type Ownership = 'off' | 'paused' | 'agent' | 'human' | 'handoff' | 'questionnaire' | 'questionnaireEnded' | 'silent'

export const INBOX_DEFAULTS = {
  /** True while an inbox page is being built (lets the shared leak-gate mocks tell it from the lead detail). */
  active: false,
  user: INBOX_USER as Record<string, unknown>,
  search: '',
  rows: LIST_ROWS as Record<string, unknown>[],
  smartCounts: SMART_COUNTS,
  messengerEnabled: true,
  messengerUnread: 4,
  /** The selected conversation target (`getInboxConversationById`); null = nothing selected. */
  selected: null as Record<string, unknown> | null,
  messages: THREAD as Msg[],
  composer: {
    health: 'operational',
    templatesEnabled: true,
    templates: TEMPLATES,
    canManageTemplates: true,
    customerWaId: '972500000001',
    businessPhoneNumberId: 'pn-1',
  } as Record<string, unknown> | null,
  ownership: 'off' as Ownership,
  handoff: HANDOFF as typeof HANDOFF | null,
  operatorTake: null as typeof OPERATOR_TAKE | null,
  intel: 'none' as 'none' | 'pending' | 'fresh' | 'stale' | 'failed',
}

export const inboxEnv = { ...INBOX_DEFAULTS }

export function resetInboxEnv() {
  Object.assign(inboxEnv, INBOX_DEFAULTS)
}

export const ACTIVE = { hasAccess: true, status: 'ACTIVE', expiresAt: null }
export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T12:00:00.000Z' }

/** Selected-conversation targets (`InboxConversationTarget`). */
export const SELECTED_LEAD = {
  conversationId: 1,
  leadId: 41,
  isPersonal: false,
  channel: 'whatsapp',
  displayName: 'יוסי לוי',
  leadName: 'יוסי לוי',
  leadStatus: 'new',
  customerWaId: '972500000001',
}
export const SELECTED_LEADLESS = {
  conversationId: 4,
  leadId: null,
  isPersonal: false,
  channel: 'whatsapp',
  displayName: '972500000004',
  leadName: null,
  leadStatus: null,
  customerWaId: '972500000004',
}

const NAMES = ['יוסי לוי', 'רונית כהן', 'משה אברהם', 'שרה מזרחי']

/**
 * Hebrew CUSTOMER data the inbox renders verbatim: contact names and their
 * avatar initials, list previews, message bodies / captions / file names, the
 * customer's handoff answers and a questionnaire's own questions and answers,
 * ready-message titles.
 */
export const INBOX_CUSTOMER_DATA = [
  ...NAMES,
  ...NAMES.map((n) =>
    n
      .split(/\s+/)
      .map((w) => w[0])
      .join(''),
  ),
  ...LIST_ROWS.map((r) => r.lastMessageText).filter((v): v is string => typeof v === 'string'),
  ...THREAD_CONTENT,
  ...CLOSED_THREAD.map((m) => m.text as string),
  ...UNKNOWN_THREAD.map((m) => m.text as string),
  HANDOFF.businessType,
  HANDOFF.need,
  HANDOFF.urgency,
  ...QUESTIONNAIRE_FIELDS.flatMap((f) => [f.label, f.value]),
  ...TEMPLATES.map((t) => t.displayTitle),
]

/** AI-written text (decision D3: never translated) — the operator take and the conversation analysis. */
export const INBOX_EXTERNAL = [AI_SUMMARY, AI_ACTION_REASON, OPERATOR_TAKE.data.actionMessage, OPERATOR_TAKE.data.reason]
