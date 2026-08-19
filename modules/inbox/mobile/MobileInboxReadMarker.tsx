'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { markConversationRead } from '@/modules/inbox/actions'
import { useAwareness } from '@/modules/inbox/awareness/AwarenessContext'
import { refreshWhatsappUnread } from '@/modules/inbox/awareness/refreshWhatsappUnread'

/**
 * Desktop's InboxReadMarker, without InboxStore.
 *
 * Opening a mobile thread never marked the conversation read, and the tab bar
 * שיחות badge is seeded from the persistent app layout — so the number stayed
 * frozen while התראות moved (NotificationContext updates itself). This calls
 * the same markConversationRead action the desktop thread uses, then refreshes
 * the awareness count the tab bar already reads.
 */
export default function MobileInboxReadMarker({
  conversationId,
  latestMessageId,
}: {
  conversationId: number
  latestMessageId: number | null
}) {
  const router = useRouter()
  const { setCount } = useAwareness()

  useEffect(() => {
    let cancelled = false
    void markConversationRead(conversationId).then(async (res) => {
      if (cancelled || !res.ok) return
      await refreshWhatsappUnread(setCount)
      if (typeof document !== 'undefined' && document.querySelector('[data-mobile-workspace]')) {
        router.refresh()
      }
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, latestMessageId, setCount, router])

  return null
}
