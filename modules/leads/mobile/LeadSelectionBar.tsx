'use client'

import MobileSelectionHeader from '@/components/mobile/MobileSelectionHeader'
import MobileStickyActions from '@/components/mobile/MobileStickyActions'
import { useT } from '@/lib/i18n/I18nProvider'

export function LeadSelectionHeader({ count, busy, onCancel }: { count: number; busy: boolean; onCancel: () => void }) {
  return <MobileSelectionHeader testId='leads-selection-bar' count={count} busy={busy} onCancel={onCancel} translated />
}

export function LeadSelectionActions({
  count,
  busy,
  canOpenItemActions,
  onCancel,
  onActions,
  onDelete,
}: {
  count: number
  busy: boolean
  canOpenItemActions: boolean
  onCancel: () => void
  onActions: () => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <MobileStickyActions aboveTabBar>
      <div className='flex w-full flex-col gap-2'>
        {canOpenItemActions && (
          <button
            type='button'
            disabled={busy || count !== 1}
            onClick={onActions}
            className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            {t('leads.mobile.selection.actions')}
          </button>
        )}
        <button
          type='button'
          disabled={busy || count === 0}
          onClick={onDelete}
          className='press flex min-h-11 w-full items-center justify-center rounded-md bg-red-600 font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {t('leads.mobile.selection.delete')}
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
