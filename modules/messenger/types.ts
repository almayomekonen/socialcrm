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
