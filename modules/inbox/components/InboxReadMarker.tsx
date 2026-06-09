'use client'

import { useEffect } from 'react'
import { markConversationRead } from '@/modules/inbox/actions'

export default function InboxReadMarker({ conversationId }: { conversationId: number }) {
  useEffect(() => {
    void markConversationRead(conversationId)
  }, [conversationId])

  return null
}
