/**
 * One `entry[].messaging[]` item from the Page webhook → a normalized event.
 *
 * Shapes per https://developers.facebook.com/docs/messenger-platform/webhooks,
 * .../reference/webhook-events/message-echoes and .../reference/webhook-events
 * (checked 2026-09-23):
 *   inbound:  sender.id = PSID, recipient.id = Page id, message { mid, text?, attachments?, quick_reply? }
 *   echo:     sender.id = Page id, recipient.id = PSID, message { is_echo: true, app_id, mid, ... }
 *   delivery: sender.id = PSID, delivery { watermark, mids? }
 *   read:     sender.id = PSID, read { watermark }
 *   postback: sender.id = PSID, postback { title?, payload?, mid?, referral? }
 *   referral: sender.id = PSID, referral { ref?, source?, type? }
 *   reaction: sender.id = PSID, reaction { action, emoji?, reaction?, mid }
 *
 * PURE and TOTAL: no DB, no clock, no Graph call, never throws. It runs inside a
 * batch where one malformed event must not strand its siblings.
 *
 * TENANCY: `pageId` is the signature-verified `entry.id`, passed in. The event's
 * own ids must AGREE with it (recipient for inbound, sender for an echo); an
 * event that names a different Page is dropped rather than trusted.
 *
 * WHY THE NON-MESSAGE EVENTS ARE NOT MESSAGES. A postback or a reaction stored
 * in `messenger_messages` would take a (pageId, mid) slot it does not own,
 * corrupt the conversation preview, and — worst — move `lastInboundAt`, which
 * is what the 24-hour send window is measured from. A reaction is not the
 * customer writing to you. They are parsed here and stored in `messenger_events`.
 */

/**
 * Meta's app id on echoes of messages a person sent from the Page inbox (Meta
 * Business Suite). The message-echoes reference prints `26390203743090`
 * (checked 2026-09-14); the 15-digit `263902037430900` is the value widely
 * reported from live payloads. Both are accepted. The only consequence of this
 * classification is a label — both are stored as outbound Page messages.
 */
export const PAGE_INBOX_APP_IDS: ReadonlySet<string> = new Set(['26390203743090', '263902037430900'])

export type MessengerAttachmentType = 'image' | 'video' | 'audio' | 'file' | 'share' | 'unsupported'

export type MessengerAttachment = {
  type: MessengerAttachmentType
  /** Meta CDN URL. Carries no token. Null when Meta sent none (e.g. a template). */
  url: string | null
  /**
   * A sticker is delivered as an image with a sticker_id. Flagged so the thread
   * can render it as a sticker (no bubble chrome) instead of a photo.
   */
  sticker?: boolean
  /** Title of shared content (`fallback`/`template` attachments). */
  title?: string | null
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

type Signal = { pageId: string; psid: string; timestamp: Date | null }

export type MessengerEvent =
  | (Base & {
      kind: 'inbound'
      /** Set when the customer tapped a quick reply rather than typing. */
      quickReplyPayload: string | null
    })
  | (Base & { kind: 'echo'; appId: string | null })
  | (Signal & { kind: 'delivery'; watermark: Date; mids: string[] })
  | (Signal & { kind: 'read'; watermark: Date })
  | (Signal & { kind: 'postback'; title: string | null; payload: string | null; referralRef: string | null })
  | (Signal & { kind: 'referral'; ref: string | null; source: string | null; refType: string | null })
  | (Signal & { kind: 'reaction'; action: 'react' | 'unreact'; emoji: string | null; targetMid: string })
  | { kind: 'ignored'; reason: 'malformed' | 'wrong_page' | 'not_a_message' | 'deleted' }

/** Event kinds that are stored as a row in `messenger_events`. */
export type MessengerEventKind = 'postback' | 'referral' | 'reaction' | 'optin'

const DISPLAYABLE = new Set(['image', 'video', 'audio', 'file'])

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Meta sends epoch milliseconds. Guarded so a bad clock cannot produce an Invalid Date. */
function epoch(v: unknown): Date | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseAttachments(raw: unknown): MessengerAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 10).map((a) => {
    const att = rec(a) ?? {}
    const payload = rec(att.payload)
    const rawType = typeof att.type === 'string' ? att.type : ''
    const url = str(payload?.url)
    const safeUrl = url && url.startsWith('https://') ? url : null

    // A shared link or a structured template. There is no media to show, but
    // there IS something to say — rendering it as "unsupported" would hide that
    // the customer sent a link.
    if (rawType === 'fallback' || rawType === 'template') {
      return { type: 'share' as const, url: safeUrl, title: str(att.title) ?? str(payload?.title) }
    }
    if (!DISPLAYABLE.has(rawType)) return { type: 'unsupported' as const, url: safeUrl }

    const sticker = payload?.sticker_id !== undefined && payload?.sticker_id !== null
    return { type: rawType as MessengerAttachmentType, url: safeUrl, ...(sticker ? { sticker: true } : {}) }
  })
}

/** Inbound and echo message events — the two that become `messenger_messages` rows. */
function parseMessage(pageId: string, e: Record<string, unknown>, message: Record<string, unknown>): MessengerEvent {
  if (message.is_deleted === true) return { kind: 'ignored', reason: 'deleted' }

  const senderId = str(rec(e.sender)?.id)
  const recipientId = str(rec(e.recipient)?.id)
  const mid = str(message.mid)
  if (!senderId || !recipientId || !mid) return { kind: 'ignored', reason: 'malformed' }

  const isEcho = message.is_echo === true
  if (isEcho ? senderId !== pageId : recipientId !== pageId) return { kind: 'ignored', reason: 'wrong_page' }

  const base: Base = {
    pageId,
    psid: isEcho ? recipientId : senderId,
    mid,
    text: typeof message.text === 'string' ? message.text : '',
    attachments: parseAttachments(message.attachments),
    timestamp: epoch(e.timestamp),
  }

  if (isEcho) return { ...base, kind: 'echo', appId: str(message.app_id) }
  return { ...base, kind: 'inbound', quickReplyPayload: str(rec(message.quick_reply)?.payload) }
}

export function parseMessagingEvent(pageId: string, raw: unknown): MessengerEvent {
  if (typeof pageId !== 'string' || !pageId) return { kind: 'ignored', reason: 'malformed' }
  const e = rec(raw)
  if (!e) return { kind: 'ignored', reason: 'malformed' }

  const message = rec(e.message)
  if (message) return parseMessage(pageId, e, message)

  // Every remaining event is ABOUT the conversation rather than a message in it.
  // All of them are addressed by the customer as `sender`, Page as `recipient`.
  const senderId = str(rec(e.sender)?.id)
  const recipientId = str(rec(e.recipient)?.id)
  if (!senderId) return { kind: 'ignored', reason: 'malformed' }
  // An echo of a non-message event would name the Page as sender; we do not
  // store those, and treating one as a customer signal would be wrong.
  if (senderId === pageId) return { kind: 'ignored', reason: 'not_a_message' }
  if (recipientId !== null && recipientId !== pageId) return { kind: 'ignored', reason: 'wrong_page' }

  const signal: Signal = { pageId, psid: senderId, timestamp: epoch(e.timestamp) }

  const delivery = rec(e.delivery)
  if (delivery) {
    const watermark = epoch(delivery.watermark)
    if (!watermark) return { kind: 'ignored', reason: 'malformed' }
    const mids = Array.isArray(delivery.mids)
      ? delivery.mids.map(str).filter((m): m is string => m !== null)
      : []
    return { ...signal, kind: 'delivery', watermark, mids }
  }

  const read = rec(e.read)
  if (read) {
    const watermark = epoch(read.watermark)
    if (!watermark) return { kind: 'ignored', reason: 'malformed' }
    return { ...signal, kind: 'read', watermark }
  }

  const postback = rec(e.postback)
  if (postback) {
    return {
      ...signal,
      kind: 'postback',
      title: str(postback.title),
      payload: str(postback.payload),
      referralRef: str(rec(postback.referral)?.ref),
    }
  }

  const referral = rec(e.referral)
  if (referral) {
    return {
      ...signal,
      kind: 'referral',
      ref: str(referral.ref),
      source: str(referral.source),
      refType: str(referral.type),
    }
  }

  const reaction = rec(e.reaction)
  if (reaction) {
    const targetMid = str(reaction.mid)
    const action = reaction.action === 'unreact' ? 'unreact' : 'react'
    if (!targetMid) return { kind: 'ignored', reason: 'malformed' }
    return { ...signal, kind: 'reaction', action, emoji: str(reaction.emoji) ?? str(reaction.reaction), targetMid }
  }

  return { kind: 'ignored', reason: 'not_a_message' }
}

/**
 * The idempotency key for one webhook event.
 *
 * A message has Meta's own `mid`. The others have no id at all, so the key is
 * derived from the content that makes the event unique: a watermark per
 * conversation, a reaction per (target message, action), a postback/referral per
 * timestamp. Meta redelivers all of these, and ("pageId", "eventKey") is UNIQUE,
 * so a redelivery lands on the existing row and changes nothing.
 */
export function messengerEventKey(event: MessengerEvent): string | null {
  switch (event.kind) {
    case 'inbound':
    case 'echo':
      return `mid:${event.mid}`
    case 'delivery':
      return `dlv:${event.psid}:${event.watermark.getTime()}`
    case 'read':
      return `read:${event.psid}:${event.watermark.getTime()}`
    case 'reaction':
      return `rx:${event.targetMid}:${event.action}:${event.psid}`
    case 'postback':
      return `pb:${event.psid}:${event.timestamp?.getTime() ?? 0}:${event.payload ?? event.title ?? ''}`
    case 'referral':
      return `ref:${event.psid}:${event.timestamp?.getTime() ?? 0}:${event.ref ?? ''}`
    default:
      return null
  }
}

/** Who produced an echoed message: SocialCRM, a person in the Page inbox, or another connected app. */
export function echoSource(appId: string | null, ourAppId: string | undefined): 'socialcrm' | 'page_inbox' | 'other_app' {
  if (appId && ourAppId && appId === ourAppId) return 'socialcrm'
  if (appId && PAGE_INBOX_APP_IDS.has(appId)) return 'page_inbox'
  return 'other_app'
}
