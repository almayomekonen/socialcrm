'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTransition } from 'react'
import { loadMoreInboxConversations } from '@/modules/inbox/actions'
import { mergeConversationPages } from '@/modules/inbox/mergeConversationPages'
import type { InboxConversationListItem, InboxCursor, InboxListFilters } from '@/modules/inbox/types'
import InboxSyncLoop from './InboxSyncLoop'

type InboxStoreValue = {
  items: InboxConversationListItem[]
  cursor: InboxCursor | null
  loadingMore: boolean
  loadMore: () => void
  /** Instant local read after a confirmed markConversationRead (no-op when delta-sync is off). */
  applyLocalRead: (conversationId: number) => { wasUnread: boolean }
}

const InboxStoreContext = createContext<InboxStoreValue | null>(null)

export function useInboxStore(): InboxStoreValue {
  const ctx = useContext(InboxStoreContext)
  if (!ctx) throw new Error('useInboxStore must be used within InboxStoreProvider')
  return ctx
}

/** ISO timestamps sort lexically = chronologically; newest first (the 'latest' view). */
function upsertByMostRecent(
  base: InboxConversationListItem[],
  changed: InboxConversationListItem[],
): InboxConversationListItem[] {
  const map = new Map(base.map((i) => [i.conversationId, i]))
  for (const c of changed) map.set(c.conversationId, c)
  return [...map.values()].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
}

export function InboxStoreProvider({
  initialItems,
  initialCursor,
  filters,
  filtersKey,
  selectedConversationId,
  deltaSyncEnabled,
  children,
}: {
  initialItems: InboxConversationListItem[]
  initialCursor: InboxCursor | null
  filters: InboxListFilters
  filtersKey: string
  selectedConversationId: number | null
  deltaSyncEnabled: boolean
  children: ReactNode
}) {
  // `base` = the live first page; `extra` = locally-accumulated "load more" pages.
  const [base, setBase] = useState<InboxConversationListItem[]>(initialItems)
  const [extra, setExtra] = useState<InboxConversationListItem[]>([])
  const [cursor, setCursor] = useState(initialCursor)
  const [loadingMore, startLoadMore] = useTransition()

  // Reconcile from server truth. router.refresh() (the soak safety net) replaces the
  // `initialItems` prop on every refresh → reset base to it (extra/cursor preserved).
  // Runs in BOTH flag modes, so with delta-sync OFF the list behaves exactly as
  // before; with it ON, fast mergeSync deltas are corrected to server truth on refresh.
  useEffect(() => {
    setBase(initialItems)
  }, [initialItems])

  // Filter change is a fresh view (the old key={filtersKey} remount): drop the
  // accumulated pagination and reset the cursor to the new filter's first page.
  const prevFiltersKey = useRef(filtersKey)
  useEffect(() => {
    if (prevFiltersKey.current === filtersKey) return
    prevFiltersKey.current = filtersKey
    setExtra([])
    setCursor(initialCursor)
  }, [filtersKey, initialCursor])

  const items = useMemo(() => mergeConversationPages(base, extra), [base, extra])

  const mergeSync = useCallback((changed: InboxConversationListItem[]) => {
    if (changed.length === 0) return
    setBase((prev) => upsertByMostRecent(prev, changed))
  }, [])

  const applyLocalRead = useCallback(
    (conversationId: number) => {
      if (!deltaSyncEnabled) return { wasUnread: false }
      let wasUnread = false
      const clear = (arr: InboxConversationListItem[]) =>
        arr.map((i) => {
          if (i.conversationId !== conversationId) return i
          if (i.unread) wasUnread = true
          return i.unread ? { ...i, unread: false } : i
        })
      setBase(clear)
      setExtra(clear)
      return { wasUnread }
    },
    [deltaSyncEnabled],
  )

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return
    startLoadMore(async () => {
      const page = await loadMoreInboxConversations({ cursor, filters })
      setExtra((prev) => mergeConversationPages(prev, page.items))
      setCursor(page.nextCursor)
    })
  }, [cursor, loadingMore, filters])

  const value = useMemo<InboxStoreValue>(
    () => ({ items, cursor, loadingMore, loadMore, applyLocalRead }),
    [items, cursor, loadingMore, loadMore, applyLocalRead],
  )

  return (
    <InboxStoreContext.Provider value={value}>
      {deltaSyncEnabled ? (
        <InboxSyncLoop mergeSync={mergeSync} filters={filters} selectedConversationId={selectedConversationId} />
      ) : null}
      {children}
    </InboxStoreContext.Provider>
  )
}
