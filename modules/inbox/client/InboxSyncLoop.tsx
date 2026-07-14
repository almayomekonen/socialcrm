'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAwareness } from '@/modules/inbox/awareness/AwarenessContext'
import { useInboxStore } from './inboxStore'
import { useAdaptivePoll } from './useAdaptivePoll'
import { serializeInboxFilters } from './serializeInboxFilters'
import { useCrmSyncHealth } from '@/lib/polling/CrmSyncHealthContext'
import { INBOX_RECOVERY_MS } from '@/lib/polling/syncFailure'
import { shouldApplySyncResponse } from './syncRequestGuard'
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
  const filtersKeyRef = useRef(JSON.stringify(filters))
  const { report } = useCrmSyncHealth()
  const retryRef = useRef<(() => void) | null>(null)

  // Drop stale responses when filters change mid-flight (A1 amenity; safe here).
  filtersKeyRef.current = JSON.stringify(filters)

  const poll = useCallback(async () => {
    const requestFiltersKey = filtersKeyRef.current
    const params = serializeInboxFilters(filters)
    params.set('since', sinceRef.current)
    if (activeConversationId != null) {
      params.set('conversation', String(activeConversationId))
      params.set('after', String(activeLatestMessageId ?? 0))
    }
    let res: Response
    try {
      res = await fetch(`/api/inbox/sync?${params.toString()}`, { cache: 'no-store' })
    } catch {
      return { changed: false, failed: true }
    }
    if (!res.ok) {
      console.warn('[inbox.sync]', { status: res.status })
      return { changed: false, failed: true }
    }
    if (!shouldApplySyncResponse(requestFiltersKey, filtersKeyRef.current)) {
      return { changed: false, failed: false }
    }
    const data = (await res.json()) as SyncResponse
    mergeSync(data.changed)
    setCount(data.counts.whatsappUnread)
    if (data.active && activeConversationId != null) appendActiveMessages(activeConversationId, data.active.messages)
    sinceRef.current = data.serverTime
    const threadChanged = (data.active?.messages.length ?? 0) > 0
    return { changed: data.changed.length > 0 || threadChanged, failed: false }
  }, [filters, mergeSync, setCount, appendActiveMessages, activeConversationId, activeLatestMessageId])

  useAdaptivePoll(poll, {
    recoveryMs: INBOX_RECOVERY_MS,
    retryRef,
    onConsecutiveFailures: (failures) => {
      report('inbox-sync', failures, retryRef.current)
    },
  })

  useEffect(() => {
    return () => report('inbox-sync', 0, null)
  }, [report])

  return null
}
