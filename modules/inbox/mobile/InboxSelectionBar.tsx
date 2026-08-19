'use client'

import MobileStickyActions from '@/components/mobile/MobileStickyActions'

/** Selection header — cancel + count. Replaces the search bar while selecting. */
export function InboxSelectionHeader({ count, busy, onCancel }: { count: number; busy: boolean; onCancel: () => void }) {
  return (
    <div
      data-testid='inbox-selection-bar'
      className='sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-gray-200 bg-white px-2'
    >
      <button
        type='button'
        onClick={onCancel}
        disabled={busy}
        className='flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        ביטול
      </button>
      <p className='min-w-0 flex-1 truncate text-base font-bold text-ink'>{`נבחרו ${count}`}</p>
    </div>
  )
}

/** Selection actions pinned above the tab bar. */
export function InboxSelectionActions({
  count,
  canMarkRead,
  busy,
  onCancel,
  onDelete,
  onMarkRead,
}: {
  count: number
  canMarkRead: boolean
  busy: boolean
  onCancel: () => void
  onDelete: () => void
  onMarkRead: () => void
}) {
  return (
    <MobileStickyActions aboveTabBar>
      <div className='flex w-full flex-col gap-2'>
        {canMarkRead && (
          <button
            type='button'
            disabled={busy || count === 0}
            onClick={onMarkRead}
            className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            סמן כנקרא
          </button>
        )}
        <button
          type='button'
          disabled={busy || count === 0}
          onClick={onDelete}
          className='press flex min-h-11 w-full items-center justify-center rounded-md bg-red-600 font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          מחק
        </button>
        <button
          type='button'
          disabled={busy}
          onClick={onCancel}
          className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          ביטול
        </button>
      </div>
    </MobileStickyActions>
  )
}
