'use client'

import { useCallback, useRef } from 'react'
import { useAwareness } from '@/modules/inbox/awareness/AwarenessContext'
import { useAdaptivePoll } from './useAdaptivePoll'
import { serializeInboxFilters } from './serializeInboxFilters'
import type { InboxConversationListItem, InboxListFilters } from '@/modules/inbox/types'

type SyncResponse = {
  counts: { whatsappUnread: number }
  changed: InboxConversationListItem[]
  items: unknown[]
  serverTime: string
  full: boolean
}

export default function InboxSyncLoop({
  mergeSync,
  filters,
  selectedConversationId: _selectedConversationId,
}: {
  mergeSync: (changed: InboxConversationListItem[]) => void
  filters: InboxListFilters
  selectedConversationId: number | null
}) {
  const { setCount } = useAwareness()
  const since = useRef<string>(new Date().toISOString())

  const poll = useCallback(async () => {
    const params = serializeInboxFilters(filters)
    params.set('since', since.current)
    const res = await fetch(`/api/inbox/sync?${params.toString()}`, { cache: 'no-store' })
    if (!res.ok) return { changed: false }
    const data = (await res.json()) as SyncResponse
    mergeSync(data.changed)
    setCount(data.counts.whatsappUnread)
    since.current = data.serverTime
    return { changed: data.changed.length > 0 }
  }, [filters, mergeSync, setCount])

  useAdaptivePoll(poll)
  return null
}
