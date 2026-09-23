import type { MetaGraphError } from '@/lib/facebook/graphClient'

/**
 * Messenger sending rules — pure, no DB, safe in a client bundle.
 *
 * STANDARD MESSAGING WINDOW (https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages,
 * checked 2026-09-14): a Page may reply with `messaging_type: RESPONSE` within
 * 24 hours of the person's last message. Outside it Meta requires a message tag;
 * the only human-reply tag, HUMAN_AGENT, is a separately reviewed feature that
 * SocialCRM has not requested — so outside the window SocialCRM does not send.
 * The window is enforced here, on the server, before any call to Meta; Meta's
 * own refusal is still mapped in case the clocks disagree.
 */

export const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000

/** Messenger text message limit. */
export const MESSENGER_TEXT_MAX = 2000

export type MessengerWindow = { open: boolean; closesAt: Date | null }

/** `now` is injected: computed once on the server and passed down, never re-derived during client render. */
export function messengerWindow(lastInboundAt: Date | string | null, now: Date): MessengerWindow {
  if (!lastInboundAt) return { open: false, closesAt: null }
  const last = new Date(lastInboundAt)
  if (Number.isNaN(last.getTime())) return { open: false, closesAt: null }
  const closesAt = new Date(last.getTime() + MESSENGER_WINDOW_MS)
  return { open: now.getTime() < closesAt.getTime(), closesAt }
}

export type MessengerSendFailure =
  | 'not_enabled'
  /** The chosen file is not something we will send (size/type). Decided locally, never by Meta. */
  | 'invalid_file'
  | 'not_found'
  | 'empty'
  | 'too_long'
  | 'window_closed'
  | 'permission_missing'
  | 'reconnect_required'
  | 'recipient_unavailable'
  | 'rate_limited'
  | 'meta_error'

/**
 * Send API error → a reason the rep can act on. Code references: Graph error
 * handling guide (190, 4/17/32/613, 10/200-299) and the Messenger Send API
 * errors — 10 + subcode 2018278 "sent outside of allowed window",
 * 551 + subcode 1545041 "This person isn't available right now",
 * 100 + subcode 2018001 "No matching user found". Meta's Messenger error-code
 * page returned HTTP 500 on 2026-09-14; the subcodes were confirmed from Meta's
 * developer community threads and must be re-checked in a live test.
 */
export function sendFailureFromGraph(error: MetaGraphError): MessengerSendFailure {
  if (error.kind !== 'graph') return 'meta_error'
  const { code, subcode } = error
  if (code === 190 || error.status === 401) return 'reconnect_required'
  if (subcode === 2018278) return 'window_closed'
  if (code === 551 || subcode === 1545041 || subcode === 2018001) return 'recipient_unavailable'
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limited'
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return 'permission_missing'
  return 'meta_error'
}

/**
 * `clients.leadSource` for a lead created from a Messenger conversation —
 * exactly the conversation's key. A PSID is only unique within its Page, and a
 * conversation belongs to one agency, so both are part of it; the global unique
 * index on leadSource then guarantees one lead per conversation, and a Page
 * reconnected by another agency can never collide with the previous owner's lead.
 */
export function messengerLeadSource(agencyId: number, pageId: string, psid: string): string {
  return `messenger:${agencyId}:${pageId}:${psid}`
}

/** Relative, timezone-free guidance for the composer. Computed on the server with `now`. */
export function messengerWindowHint(window: MessengerWindow, now: Date): string | null {
  if (!window.open || !window.closesAt) return null
  const hours = Math.floor((window.closesAt.getTime() - now.getTime()) / 3_600_000)
  return hours >= 1 ? `אפשר להשיב עוד כ-${hours} שעות` : 'חלון המענה ייסגר בפחות משעה'
}
