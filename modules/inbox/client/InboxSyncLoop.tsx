'use client'

import { useCallback, useRef } from 'react'
import { useAwareness } from '@/modules/inbox/awareness/AwarenessContext'
import { useInboxStore } from './inboxStore'
import { useAdaptivePoll } from './useAdaptivePoll'
import { serializeInboxFilters } from './serializeInboxFilters'
import type { InboxConversationListItem, InboxListFilters } from '@/modules/inbox/types'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'

type SyncResponse = {
  counts: { whatsappUnread: number }
  changed: InboxConversationListItem[]
  active?: { messages: LeadWhatsappMessage[]; latestMessageId: number }
  items: unknown[]
  serverTime: string
  full: boolean
}

export default function InboxSyncLoop({ filters }: { filters: InboxListFilters }) {
  const { setCount } = useAwareness()
  const { mergeSync, appendActiveMessages, activeConversationId, activeLatestMessageId } = useInboxStore()
  const sinceRef = useRef<string>(new Date().toISOString())

  const poll = useCallback(async () => {
    const params = serializeInboxFilters(filters)
    params.set('since', sinceRef.current)
    if (activeConversationId != null) {
      params.set('conversation', String(activeConversationId))
      params.set('after', String(activeLatestMessageId ?? 0))
    }
    const res = await fetch(`/api/inbox/sync?${params.toString()}`, { cache: 'no-store' })
    if (!res.ok) return { changed: false }
    const data = (await res.json()) as SyncResponse
    mergeSync(data.changed)
    setCount(data.counts.whatsappUnread)
    if (data.active && activeConversationId != null) appendActiveMessages(activeConversationId, data.active.messages)
    sinceRef.current = data.serverTime
    const threadChanged = (data.active?.messages.length ?? 0) > 0
    return { changed: data.changed.length > 0 || threadChanged }
  }, [filters, mergeSync, setCount, appendActiveMessages, activeConversationId, activeLatestMessageId])

  useAdaptivePoll(poll)
  return null
}
