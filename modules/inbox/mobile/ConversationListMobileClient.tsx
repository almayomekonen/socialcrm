'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from '@/lib/toast'
import ConfirmSheet from '@/components/mobile/ConfirmSheet'
import { deleteConversation, loadMoreInboxConversations, markConversationRead } from '@/modules/inbox/actions'
import { DEFAULT_INBOX_FILTERS, type InboxCursor } from '@/modules/inbox/types'
import ConversationSearchBar from './ConversationSearchBar'
import ConversationRowMobile from './ConversationRowMobile'
import EmptyConversationsMobile from './EmptyConversationsMobile'
import { InboxSelectionActions, InboxSelectionHeader } from './InboxSelectionBar'
import {
  markRowsRead,
  removeSelectedRows,
  restoreRows,
  restoreUnread,
  selectedUnreadIds,
  type ConversationListRow,
} from './conversationSelection'
import { relativeTimeHe } from './relativeTime'

/**
 * Client island for the mobile conversation list: selection, optimistic delete /
 * mark-as-read, and cursor load-more. Mutations are the existing per-id actions.
 * No router.refresh() — the list is local until the next server render.
 */
export default function ConversationListMobileClient({
  items: initialItems,
  q,
  nextCursor: initialCursor,
}: {
  items: ConversationListRow[]
  q: string
  nextCursor: InboxCursor | null
}) {
  const [items, setItems] = useState(initialItems)
  const [cursor, setCursor] = useState(initialCursor)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingMore, startLoadMore] = useTransition()
  const pendingRef = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (pendingRef.current > 0) return
    setItems(initialItems)
    setCursor(initialCursor)
  }, [initialItems, initialCursor])

  useEffect(() => {
    setSelecting(false)
    setSelected(new Set())
    setConfirmOpen(false)
  }, [q])

  const exit = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
    setConfirmOpen(false)
  }, [])

  const enter = useCallback((id: number) => {
    setSelecting(true)
    setSelected(new Set([id]))
  }, [])

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const unreadIds = selectedUnreadIds(items, selected)

  const runDelete = async () => {
    const ids = new Set(selected)
    if (ids.size === 0) return
    const snapshot = itemsRef.current
    pendingRef.current += 1
    setBusy(true)
    setConfirmOpen(false)
    setItems(removeSelectedRows(snapshot, ids))
    const results = await Promise.allSettled([...ids].map((id) => deleteConversation(id)))
    const failed = new Set<number>()
    let i = 0
    for (const id of ids) {
      const r = results[i++]
      if (r.status === 'rejected' || !r.value.ok) failed.add(id)
    }
    if (failed.size > 0) {
      setItems((current) => restoreRows(current, snapshot, failed))
      setSelected(failed)
      toast('error', failed.size === ids.size ? 'מחיקת השיחות נכשלה. נסה שוב.' : 'חלק מהשיחות לא נמחקו. נסה שוב.')
    } else {
      exit()
    }
    pendingRef.current -= 1
    setBusy(false)
  }

  const runMarkRead = async () => {
    const ids = new Set(unreadIds)
    if (ids.size === 0) return
    const snapshot = itemsRef.current
    pendingRef.current += 1
    setBusy(true)
    setItems(markRowsRead(snapshot, ids))
    const results = await Promise.allSettled([...ids].map((id) => markConversationRead(id)))
    const failed = new Set<number>()
    let i = 0
    for (const id of ids) {
      const r = results[i++]
      if (r.status === 'rejected' || !r.value.ok) failed.add(id)
    }
    if (failed.size > 0) {
      setItems((current) => restoreUnread(current, snapshot, failed))
      toast('error', 'לא הצלחנו לסמן כנקרא. נסה שוב.')
    }
    pendingRef.current -= 1
    setBusy(false)
  }

  const loadMore = () => {
    if (!cursor || loadingMore) return
    startLoadMore(async () => {
      const page = await loadMoreInboxConversations({
        cursor,
        filters: { ...DEFAULT_INBOX_FILTERS, q: q || null },
      })
      const nowMs = Date.now()
      const extra: ConversationListRow[] = page.items.map((row) => ({
        ...row,
        when: relativeTimeHe(row.lastMessageAt, nowMs),
      }))
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.conversationId))
        return [...prev, ...extra.filter((r) => !seen.has(r.conversationId))]
      })
      setCursor(page.nextCursor)
    })
  }

  const count = selected.size
  const deleteMsg =
    count === 1
      ? 'האם למחוק שיחה אחת?\nלא ניתן לשחזר את השיחות לאחר המחיקה.'
      : `האם למחוק ${count} שיחות?\nלא ניתן לשחזר את השיחות לאחר המחיקה.`

  return (
    <div className='flex min-h-full flex-col'>
      {selecting ? (
        <InboxSelectionHeader count={count} busy={busy} onCancel={exit} />
      ) : (
        <ConversationSearchBar q={q} resultCount={items.length} />
      )}

      {items.length === 0 ? (
        <EmptyConversationsMobile q={q} />
      ) : (
        <ul className='divide-y divide-gray-100'>
          {items.map((c) => (
            <ConversationRowMobile
              key={c.conversationId}
              item={c}
              selecting={selecting}
              selected={selected.has(c.conversationId)}
              onToggle={() => toggle(c.conversationId)}
              onEnterSelection={() => enter(c.conversationId)}
            />
          ))}
        </ul>
      )}

      {!selecting && cursor && items.length > 0 && (
        <div className='px-4 py-3'>
          <button
            type='button'
            disabled={loadingMore}
            onClick={loadMore}
            className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            {loadingMore ? 'טוען…' : 'טען עוד שיחות'}
          </button>
        </div>
      )}

      {selecting && (
        <InboxSelectionActions
          count={count}
          canMarkRead={unreadIds.length > 0}
          busy={busy}
          onCancel={exit}
          onDelete={() => setConfirmOpen(true)}
          onMarkRead={runMarkRead}
        />
      )}

      <ConfirmSheet
        open={confirmOpen}
        destructive
        title='מחיקת שיחות'
        msg={deleteMsg}
        confirmLbl={count === 1 ? 'מחק שיחה' : 'מחק שיחות'}
        cancelLbl='ביטול'
        onClose={() => setConfirmOpen(false)}
        onConfirm={runDelete}
      />
    </div>
  )
}
