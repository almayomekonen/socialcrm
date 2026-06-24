'use client'

import { useMemo, useState, useTransition } from 'react'
import { loadMoreInboxConversations } from '@/modules/inbox/actions'
import { mergeConversationPages } from '@/modules/inbox/mergeConversationPages'
import InboxConversationRow from './InboxConversationRow'
import type { InboxConversationListItem, InboxCursor, InboxListFilters } from '@/modules/inbox/types'

export default function InboxConversationList({
  initialItems,
  initialCursor,
  selectedConversationId,
  filters,
}: {
  initialItems: InboxConversationListItem[]
  initialCursor: InboxCursor | null
  selectedConversationId: number | null
  filters: InboxListFilters
}) {
  // `initialItems` is the server's first page — refreshed live by the page-level
  // poller's router.refresh(). We render directly from it (no frozen useState
  // snapshot) merged with locally-accumulated "load more" pages.
  const [extraPages, setExtraPages] = useState<InboxConversationListItem[]>([])
  const [cursor, setCursor] = useState(initialCursor)
  const [pending, startTransition] = useTransition()

  const items = useMemo(() => mergeConversationPages(initialItems, extraPages), [initialItems, extraPages])

  const loadMore = () => {
    if (!cursor || pending) return
    startTransition(async () => {
      const page = await loadMoreInboxConversations({ cursor, filters })
      setExtraPages((prev) => mergeConversationPages(prev, page.items))
      setCursor(page.nextCursor)
    })
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {items.length === 0 ? (
          <p className='p-4 text-center text-sm text-gray-400'>לא נמצאו שיחות</p>
        ) : (
          <>
            {items.map((item) => (
              <InboxConversationRow
                key={item.conversationId}
                item={item}
                selected={item.conversationId === selectedConversationId}
              />
            ))}
            {cursor && (
              <button
                type='button'
                onClick={loadMore}
                disabled={pending}
                className='w-full px-3 py-2.5 text-center text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50'
              >
                {pending ? 'טוען...' : 'טען עוד'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
