'use client'

import { useEffect } from 'react'
import { markConversationRead } from '@/modules/inbox/actions'
import { useInboxStore } from '@/modules/inbox/client/inboxStore'

export default function InboxReadMarker({
  conversationId,
  latestMessageId,
}: {
  conversationId: number
  latestMessageId: number | null
}) {
  const { applyLocalRead } = useInboxStore()

  useEffect(() => {
    let cancelled = false
    // On confirmed read, clear the row's unread state in the shared store
    // immediately — don't wait for the next sync cycle (no-op when delta-sync is off).
    void markConversationRead(conversationId).then((res) => {
      if (!cancelled && res.ok) applyLocalRead(conversationId)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, latestMessageId, applyLocalRead])

  return null
}
