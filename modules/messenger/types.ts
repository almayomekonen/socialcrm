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
}

export type MessengerMessage = {
  id: number
  direction: 'inbound' | 'outbound'
  source: 'customer' | 'socialcrm' | 'page_inbox' | 'other_app'
  text: string
  attachments: MessengerAttachment[]
  timestamp: Date
}
