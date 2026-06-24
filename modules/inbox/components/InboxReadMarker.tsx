'use client'

import { useEffect } from 'react'
import { markConversationRead } from '@/modules/inbox/actions'

export default function InboxReadMarker({
  conversationId,
  latestMessageId,
}: {
  conversationId: number
  latestMessageId: number | null
}) {
  useEffect(() => {
    void markConversationRead(conversationId)
  }, [conversationId, latestMessageId])

  return null
}
