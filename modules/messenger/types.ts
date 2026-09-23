import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'

/**
 * Messenger inbox shapes. A PSID is deliberately NOT part of any client-bound
 * shape: the UI addresses a conversation by its row id, and the server resolves
 * the PSID itself.
 */

export type MessengerConversationListItem = {
  id: number
  pageId: string
  customerName: string | null
  leadId: number | null
  leadName: string | null
  lastMessageAt: Date | null
  lastInboundAt: Date | null
  lastMessageText: string | null
  lastDirection: 'inbound' | 'outbound' | null
  /** The customer wrote after this user last opened the conversation. */
  unread: boolean
  /**
   * Meta CDN URL for the customer's picture, or null. A CACHE, not a fact: the
   * URL expires, so the UI must fall back to initials when it fails to load and
   * must never treat its absence as "this person has no picture".
   */
  profilePicUrl: string | null
  /** null = never asked. 'denied' = Meta refuses this app profile access at all. */
  profileStatus: 'ok' | 'denied' | 'unavailable' | null
}

export type MessengerMessage = {
  id: number
  direction: 'inbound' | 'outbound'
  source: 'customer' | 'socialcrm' | 'page_inbox' | 'other_app'
  text: string
  attachments: MessengerAttachment[]
  timestamp: Date
  /**
   * Only ever set from a Meta `message_deliveries` / `message_reads` event.
   * null means "no such event seen" — NOT "not delivered". The UI must stay
   * silent rather than claim a state Meta never reported.
   */
  deliveredAt: Date | null
  readAt: Date | null
}

/**
 * A non-message event in a conversation: a button/menu tap, an entry point the
 * customer arrived through, or a reaction to something the Page sent.
 *
 * Kept apart from MessengerMessage on purpose — see the migration and
 * parseMessagingEvent for why a reaction must never be stored as a message.
 */
export type MessengerConversationEvent = {
  id: number
  kind: 'postback' | 'referral' | 'reaction' | 'optin'
  /** Postback button label, referral source, or the reaction action. */
  title: string | null
  /** Postback payload, referral ref, or the emoji. */
  payload: string | null
  /**
   * For a reaction: the id of OUR message row it refers to, resolved on the
   * server. Meta's `mid` is deliberately not sent to the client — the UI
   * addresses a message by row id, exactly as it addresses a conversation.
   * Null when the reaction arrived before the message it refers to.
   */
  targetMessageId: number | null
  occurredAt: Date
}
