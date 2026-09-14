'use client'

import { useEffect } from 'react'
import { markMessengerConversationRead } from '../actions'

/**
 * Marks the open conversation read for the current user — again whenever a
 * newer message arrives while it is open. Same role as InboxReadMarker.
 */
export default function MessengerReadMarker({
  conversationId,
  latestMessageId,
}: {
  conversationId: number
  latestMessageId: number | null
}) {
  useEffect(() => {
    void markMessengerConversationRead(conversationId).catch(() => {})
  }, [conversationId, latestMessageId])
  return null
}
