'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { useNotifications } from '@/modules/notifications/NotificationContext'
import {
  appendPage,
  centerPageQuery,
  idsToStampSeen,
  type CenterFilters,
} from '@/modules/notifications/center'
import type { FeedCursor, NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'
import {
  emptySelection,
  enterSelection,
  isSelecting,
  toggleSelection,
  type SelectionState,
} from '@/components/mobile/selectionState'
import {
  markNotificationsReadLocal,
  restoreNotificationUnread,
  selectedUnreadNotificationIds,
} from '@/modules/notifications/mobile/notificationSelection'
import NotificationRow from './NotificationRow'
import NotificationCenterEmpty from './center/NotificationCenterEmpty'
import { LoadMoreButton, MarkAllReadBar } from './center/NotificationCenterControls'
import NotificationRowMobile from './mobile/NotificationRowMobile'
import {
  NotificationSelectionActions,
  NotificationSelectionHeader,
} from './mobile/NotificationSelectionBar'

/**
 * The notification center's list. Spec §13, P2.4.
 *
 * WHAT IT OWNS: the page it is looking at, and nothing else. Unread, seen and
 * read belong to `NotificationContext` — the same single owner the bell reads —
 * so marking a row read here moves the badge in the topbar without either
 * surface knowing about the other. There is no second context, no second unread
 * endpoint, and no poll: pages are fetched when the user asks for them.
 *
 * The first page arrives from the server as a prop, so the list is complete on
 * first paint. Later pages come from the existing feed endpoint, which was given
 * `?cursor=&limit=` for exactly this caller.
 *
 * Filters are URL state, never component state: the server re-renders with a
 * fresh `initialItems` and this component is keyed on the filter, so it remounts
 * instead of reconciling two different filter results. That is why there is no
 * filter logic here at all.
 */

export default function NotificationCenter({
  initialItems,
  initialCursor,
  filters,
  variant = 'desktop',
}: {
  initialItems: NotificationFeedItem[]
  initialCursor: FeedCursor | null
  filters: CenterFilters
  /**
   * Which ROW to render. Everything else — paging, seen/read stamping, the
   * optimistic read, the single `NotificationContext` owner — is identical, so
   * the two surfaces share this component rather than forking its logic. Only
   * the presentation differs. Defaults to desktop, so every existing caller is
   * unchanged.
   */
  variant?: 'desktop' | 'mobile'
}) {
  const t = useT()
  const { unreadCount, markSeen, markRead, markAllRead } = useNotifications()
  const router = useRouter()
  const isMobile = variant === 'mobile'

  const [items, setItems] = useState<NotificationFeedItem[]>(initialItems)
  const [cursor, setCursor] = useState<FeedCursor | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [sel, setSel] = useState<SelectionState>(emptySelection)
  const [busy, setBusy] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selecting = isMobile && isSelecting(sel)

  /**
   * RENDERING A ROW HERE IS A SURFACE EVENT (spec §8.2), so the rows on the page
   * get their seenAt — and only those. `markSeen` de-duplicates per session, so a
   * re-render costs no request, and rows on pages the user never loaded stay
   * unseen and keep their place in "while you were away".
   *
   * Keyed on the loaded ids so appending a page stamps the arrivals without
   * restamping what was already on screen. Read state changes do not re-run it,
   * which is the point: seen and read are independent.
   */
  const loadedKey = items.map((i) => i.id).join(',')
  useEffect(() => {
    markSeen(idsToStampSeen(items))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey])

  /**
   * After a successful `/read`, mobile calls `router.refresh()` so this page's
   * RSC payload is not a stale unread snapshot. Re-apply the server first page
   * when its read/seen facts change — `useState(initialItems)` would otherwise
   * keep the unread rows the user just marked.
   */
  const serverListKey = `${initialCursor ?? ''}|${initialItems.map((i) => `${i.id}:${i.readAt ?? ''}:${i.seenAt ?? ''}`).join(',')}`
  useEffect(() => {
    setItems(initialItems)
    setCursor(initialCursor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverListKey])

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/notifications/feed?${centerPageQuery({ cursor, filters })}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as NotificationFeedResponse
      setItems((prev) => appendPage(prev, data.items))
      setCursor(data.nextCursor)
    } catch {
      // Recoverable by asking again, so the button stays and says so. Nothing is
      // lost — the rows already on screen are still true.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [cursor, filters, loading])

  /** Optimistic, so a row dims the moment it is clicked. The next poll reconciles. */
  const markLocallyRead = (id: number) =>
    setItems((prev) => prev.map((i) => (i.id === id && !i.readAt ? { ...i, readAt: new Date().toISOString() } : i)))

  /**
   * Click a row: mark it read, then go to the ENTITY — identical to the bell,
   * deliberately. The deep link is the one the registry stored, it never carries
   * a notification id (spec §20.2), and the destination runs its own
   * authorization; nothing here pre-checks or bypasses it.
   */
  const open = useCallback(
    (item: NotificationFeedItem) => {
      markRead([item.id])
      markLocallyRead(item.id)
      router.push(item.deepLink)
    },
    [markRead, router],
  )

  function readEverything() {
    markAllRead()
    const now = new Date().toISOString()
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: now })))
  }

  const exit = useCallback(() => setSel(emptySelection()), [])
  const unreadSelected = selectedUnreadNotificationIds(items, sel.ids)

  const runMarkRead = async () => {
    const ids = new Set(unreadSelected)
    if (ids.size === 0) return
    const snapshot = itemsRef.current
    const now = new Date().toISOString()
    setBusy(true)
    setItems(markNotificationsReadLocal(snapshot, ids, now))
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...ids] }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(String(res.status))
      markRead([...ids])
    } catch {
      setItems((current) => restoreNotificationUnread(current, snapshot, ids))
      toast('error', t('inbox.mobile.list.markReadFailed'))
    }
    setBusy(false)
  }

  if (items.length === 0) return <NotificationCenterEmpty filters={filters} />

  if (!isMobile) {
    return (
      <div className='rounded-lg border border-gray-200 bg-white'>
        {unreadCount > 0 && <MarkAllReadBar onClick={readEverything} />}

        <ul className='divide-y'>
          {items.map((item) => (
            <li key={item.id}>
              <NotificationRow item={item} onSelect={open} />
            </li>
          ))}
        </ul>

        {cursor && <LoadMoreButton onClick={loadMore} loading={loading} failed={failed} />}
      </div>
    )
  }

  return (
    <div className='bg-white'>
      {selecting ? (
        <NotificationSelectionHeader count={sel.ids.size} busy={busy} onCancel={exit} />
      ) : unreadCount > 0 ? (
        <MarkAllReadBar onClick={readEverything} mobile />
      ) : null}

      <ul className='divide-y'>
        {items.map((item) => (
          <li key={item.id}>
            <NotificationRowMobile
              item={item}
              onSelect={open}
              selecting={selecting}
              selected={sel.ids.has(item.id)}
              onToggle={() => setSel((prev) => toggleSelection(prev, item.id))}
              onEnterSelection={() => setSel(enterSelection(item.id))}
            />
          </li>
        ))}
      </ul>

      {!selecting && cursor && <LoadMoreButton onClick={loadMore} loading={loading} failed={failed} mobile />}

      {selecting && (
        <NotificationSelectionActions
          count={sel.ids.size}
          canMarkRead={unreadSelected.length > 0}
          busy={busy}
          onCancel={exit}
          onMarkRead={runMarkRead}
        />
      )}
    </div>
  )
}
