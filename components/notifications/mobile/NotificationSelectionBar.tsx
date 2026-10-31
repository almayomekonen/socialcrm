'use client'

import MobileSelectionHeader from '@/components/mobile/MobileSelectionHeader'
import MobileStickyActions from '@/components/mobile/MobileStickyActions'
import { useT } from '@/lib/i18n/I18nProvider'

export function NotificationSelectionHeader({
  count,
  busy,
  onCancel,
}: {
  count: number
  busy: boolean
  onCancel: () => void
}) {
  return <MobileSelectionHeader testId='notifications-selection-bar' count={count} busy={busy} onCancel={onCancel} translated />
}

export function NotificationSelectionActions({
  count,
  canMarkRead,
  busy,
  onCancel,
  onMarkRead,
}: {
  count: number
  canMarkRead: boolean
  busy: boolean
  onCancel: () => void
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
