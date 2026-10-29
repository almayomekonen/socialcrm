'use client'

import { useInboxStore } from '@/modules/inbox/client/inboxStore'
import InboxConversationRow from './InboxConversationRow'
import { useT } from '@/lib/i18n/I18nProvider'

export default function InboxConversationList({ selectedConversationId }: { selectedConversationId: number | null }) {
  // Single source of truth: the store (seeded from the server's first page,
  // reconciled by router.refresh, and updated live by the /sync loop when enabled).
  const { items, cursor, loadingMore, loadMore } = useInboxStore()
  const t = useT()

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {items.length === 0 ? (
          <p className='p-6 text-center text-sm text-gray-400'>{t('inbox.list.empty')}</p>
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
                disabled={loadingMore}
                className='w-full px-3 py-2.5 text-center text-xs text-gray-500 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:opacity-50'
              >
                {loadingMore ? t('inbox.list.loadingMore') : t('inbox.list.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
