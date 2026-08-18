'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNotifications } from '@/modules/notifications/NotificationContext'
import {
  appendPage,
  centerPageQuery,
  idsToStampSeen,
  type CenterFilters,
} from '@/modules/notifications/center'
import type { FeedCursor, NotificationFeedItem, NotificationFeedResponse } from '@/modules/notifications/types'
import NotificationRow from './NotificationRow'
import NotificationRowMobile from './mobile/NotificationRowMobile'

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
  const { unreadCount, markSeen, markRead, markAllRead } = useNotifications()
  const router = useRouter()

  const [items, setItems] = useState<NotificationFeedItem[]>(initialItems)
  const [cursor, setCursor] = useState<FeedCursor | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

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

  if (items.length === 0) return <EmptyState filters={filters} />

  return (
    <div className='rounded-lg border border-gray-200 bg-white'>
      {unreadCount > 0 && (
        <div className='flex items-center justify-end border-b px-3 py-2'>
          <button
            type='button'
            onClick={readEverything}
            className='rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary'
          >
            סימון הכל כנקרא
          </button>
        </div>
      )}

      <ul className='divide-y'>
        {items.map((item) => (
          <li key={item.id}>
            {variant === 'mobile' ? (
              <NotificationRowMobile item={item} onSelect={open} />
            ) : (
              <NotificationRow item={item} onSelect={open} />
            )}
          </li>
        ))}
      </ul>

      {cursor && (
        <div className='border-t px-3 py-2 text-center'>
          <button
            type='button'
            onClick={loadMore}
            disabled={loading}
            className='rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary'
          >
            {loading ? 'טוען...' : failed ? 'לא הצלחנו לטעון — נסה שוב' : 'הצג עוד'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The calm empty state (ux-guidelines §4). Which sentence depends on WHY the list
 * is empty: nothing has arrived, or a filter is hiding what has. Telling someone
 * with a filter on that they have no notifications would simply be false.
 */
function EmptyState({ filters }: { filters: CenterFilters }) {
  const filtered = filters.unreadOnly || filters.category !== null
  return (
    <div className='rounded-lg border border-gray-200 bg-white px-4 py-12 text-center'>
      <p className='text-sm text-gray-700'>{filtered ? 'אין התראות שתואמות לסינון' : 'אין התראות'}</p>
      <p className='mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500'>
        {filtered
          ? 'אפשר להסיר את הסינון ולראות את כל ההתראות.'
          : 'כשליד חדש ייכנס או כשמשהו ידרוש טיפול, זה יופיע כאן.'}
      </p>
    </div>
  )
}
