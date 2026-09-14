/**
 * One `entry[].messaging[]` item from the Page webhook → a normalized event.
 *
 * Shapes per https://developers.facebook.com/docs/messenger-platform/webhooks
 * and .../reference/webhook-events/message-echoes (checked 2026-09-14):
 *   inbound: sender.id = PSID, recipient.id = Page id, message { mid, text?, attachments? }
 *   echo:    sender.id = Page id, recipient.id = PSID, message { is_echo: true, app_id, mid, ... }
 *
 * PURE and TOTAL: no DB, no clock, no Graph call, never throws. It runs inside a
 * batch where one malformed event must not strand its siblings.
 *
 * TENANCY: `pageId` is the signature-verified `entry.id`, passed in. The event's
 * own ids must AGREE with it (recipient for inbound, sender for an echo); an
 * event that names a different Page is dropped rather than trusted.
 */

/**
 * Meta's app id on echoes of messages a person sent from the Page inbox (Meta
 * Business Suite). The message-echoes reference prints `26390203743090`
 * (checked 2026-09-14); the 15-digit `263902037430900` is the value widely
 * reported from live payloads. Both are accepted. The only consequence of this
 * classification is a label — both are stored as outbound Page messages.
 */
export const PAGE_INBOX_APP_IDS: ReadonlySet<string> = new Set(['26390203743090', '263902037430900'])

export type MessengerAttachmentType = 'image' | 'video' | 'audio' | 'file' | 'unsupported'

export type MessengerAttachment = {
  type: MessengerAttachmentType
  /** Meta CDN URL. Carries no token. Null when Meta sent none (e.g. a template). */
  url: string | null
}

type Base = {
  pageId: string
  psid: string
  mid: string
  text: string
  attachments: MessengerAttachment[]
  /** Meta's event time. Ordering uses this, never arrival order. */
  timestamp: Date | null
}

export type MessengerEvent =
  | (Base & { kind: 'inbound' })
  | (Base & { kind: 'echo'; appId: string | null })
  | { kind: 'ignored'; reason: 'malformed' | 'wrong_page' | 'not_a_message' | 'deleted' }

const DISPLAYABLE = new Set(['image', 'video', 'audio', 'file'])

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseAttachments(raw: unknown): MessengerAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 10).map((a) => {
    const att = rec(a) ?? {}
    const type = typeof att.type === 'string' && DISPLAYABLE.has(att.type) ? (att.type as MessengerAttachmentType) : 'unsupported'
    const url = str(rec(att.payload)?.url)
    // Only https URLs are kept; anything else is not something we will render or link.
    return { type, url: url && url.startsWith('https://') ? url : null }
  })
}

export function parseMessagingEvent(pageId: string, raw: unknown): MessengerEvent {
  if (typeof pageId !== 'string' || !pageId) return { kind: 'ignored', reason: 'malformed' }
  const e = rec(raw)
  if (!e) return { kind: 'ignored', reason: 'malformed' }

  const message = rec(e.message)
  // Reads, deliveries, postbacks, reactions, referrals: not messages we store.
  if (!message) return { kind: 'ignored', reason: 'not_a_message' }
  if (message.is_deleted === true) return { kind: 'ignored', reason: 'deleted' }

  const senderId = str(rec(e.sender)?.id)
  const recipientId = str(rec(e.recipient)?.id)
  const mid = str(message.mid)
  if (!senderId || !recipientId || !mid) return { kind: 'ignored', reason: 'malformed' }

  const isEcho = message.is_echo === true
  if (isEcho ? senderId !== pageId : recipientId !== pageId) return { kind: 'ignored', reason: 'wrong_page' }

  const ts = typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) ? new Date(e.timestamp) : null
  const base: Base = {
    pageId,
    psid: isEcho ? recipientId : senderId,
    mid,
    text: typeof message.text === 'string' ? message.text : '',
    attachments: parseAttachments(message.attachments),
    timestamp: ts,
  }

  return isEcho ? { ...base, kind: 'echo', appId: str(message.app_id) } : { ...base, kind: 'inbound' }
}

/** Who produced an echoed message: SocialCRM, a person in the Page inbox, or another connected app. */
export function echoSource(appId: string | null, ourAppId: string | undefined): 'socialcrm' | 'page_inbox' | 'other_app' {
  if (appId && ourAppId && appId === ourAppId) return 'socialcrm'
  if (appId && PAGE_INBOX_APP_IDS.has(appId)) return 'page_inbox'
  return 'other_app'
}
