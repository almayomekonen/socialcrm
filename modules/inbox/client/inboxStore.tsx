'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTransition } from 'react'
import { loadMoreInboxConversations } from '@/modules/inbox/actions'
import { mergeConversationPages } from '@/modules/inbox/mergeConversationPages'
import { compareInboxItems } from './compareInboxItems'
import type { InboxConversationListItem, InboxCursor, InboxListFilters, InboxSort } from '@/modules/inbox/types'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import InboxSyncLoop from './InboxSyncLoop'

type InboxStoreValue = {
  // ── Conversation list ──
  items: InboxConversationListItem[]
  cursor: InboxCursor | null
  loadingMore: boolean
  loadMore: () => void
  /** Instant local read after a confirmed markConversationRead (no-op when delta-sync is off). */
  applyLocalRead: (conversationId: number) => { wasUnread: boolean }
  /** List delta from the sync loop. */
  mergeSync: (changed: InboxConversationListItem[]) => void
  // ── Open thread ──
  activeConversationId: number | null
  activeMessages: LeadWhatsappMessage[]
  activeLatestMessageId: number | null
  /** Seed (or re-seed on switch/refresh) the open thread from server messages. */
  initActiveThread: (conversationId: number, messages: LeadWhatsappMessage[]) => void
  /** Thread delta from the sync loop (guarded to the still-open conversation). */
  appendActiveMessages: (conversationId: number, messages: LeadWhatsappMessage[]) => void
}

const InboxStoreContext = createContext<InboxStoreValue | null>(null)

export function useInboxStore(): InboxStoreValue {
  const ctx = useContext(InboxStoreContext)
  if (!ctx) throw new Error('useInboxStore must be used within InboxStoreProvider')
  return ctx
}

/** Upsert delta rows by conversationId, then re-order to match the active server sort. */
function upsertAndSort(
  base: InboxConversationListItem[],
  changed: InboxConversationListItem[],
  sort: InboxSort,
): InboxConversationListItem[] {
  const map = new Map(base.map((i) => [i.conversationId, i]))
  for (const c of changed) map.set(c.conversationId, c)
  return [...map.values()].sort(compareInboxItems(sort))
}

export function InboxStoreProvider({
  initialItems,
  initialCursor,
  filters,
  filtersKey,
  deltaSyncEnabled,
  children,
}: {
  initialItems: InboxConversationListItem[]
  initialCursor: InboxCursor | null
  filters: InboxListFilters
  filtersKey: string
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

  const mergeSync = useCallback(
    (changed: InboxConversationListItem[]) => {
      if (changed.length === 0) return
      setBase((prev) => upsertAndSort(prev, changed, filters.sort))
    },
    [filters.sort],
  )

  // ── Open-thread state ──
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [activeMessages, setActiveMessages] = useState<LeadWhatsappMessage[]>([])
  const activeConvIdRef = useRef<number | null>(null)
  const activeLatestMessageId = activeMessages.length > 0 ? activeMessages[activeMessages.length - 1].id : null

  const initActiveThread = useCallback((conversationId: number, messages: LeadWhatsappMessage[]) => {
    activeConvIdRef.current = conversationId
    setActiveConversationId(conversationId)
    setActiveMessages(messages)
  }, [])

  const appendActiveMessages = useCallback((conversationId: number, incoming: LeadWhatsappMessage[]) => {
    // Guard against a mid-flight conversation switch landing on the wrong thread.
    if (incoming.length === 0 || activeConvIdRef.current !== conversationId) return
    setActiveMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id))
      const fresh = incoming.filter((m) => !ids.has(m.id))
      return fresh.length ? [...prev, ...fresh] : prev
    })
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
    () => ({
      items,
      cursor,
      loadingMore,
      loadMore,
      applyLocalRead,
      mergeSync,
      activeConversationId,
      activeMessages,
      activeLatestMessageId,
      initActiveThread,
      appendActiveMessages,
    }),
    [
      items,
      cursor,
      loadingMore,
      loadMore,
      applyLocalRead,
      mergeSync,
      activeConversationId,
      activeMessages,
      activeLatestMessageId,
      initActiveThread,
      appendActiveMessages,
    ],
  )

  return (
    <InboxStoreContext.Provider value={value}>
      {deltaSyncEnabled ? <InboxSyncLoop filters={filters} /> : null}
      {children}
    </InboxStoreContext.Provider>
  )
}
