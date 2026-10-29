'use client'

import MobileSelectionHeader from '@/components/mobile/MobileSelectionHeader'
import MobileStickyActions from '@/components/mobile/MobileStickyActions'
import { useT } from '@/lib/i18n/I18nProvider'

/** Selection header — cancel + count. Replaces the search bar while selecting. */
export function InboxSelectionHeader({ count, busy, onCancel }: { count: number; busy: boolean; onCancel: () => void }) {
  return <MobileSelectionHeader testId='inbox-selection-bar' count={count} busy={busy} onCancel={onCancel} translated />
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
  const t = useT()
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
            {t('inbox.mobile.selection.markRead')}
          </button>
        )}
        <button
          type='button'
          disabled={busy || count === 0}
          onClick={onDelete}
          className='press flex min-h-11 w-full items-center justify-center rounded-md bg-red-600 font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {t('inbox.mobile.selection.delete')}
        </button>
        <button
          type='button'
          disabled={busy}
          onClick={onCancel}
          className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {t('common.dialog.cancel')}
        </button>
      </div>
    </MobileStickyActions>
  )
}
