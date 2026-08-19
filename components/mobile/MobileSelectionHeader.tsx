'use client'

/**
 * Shared selection header — cancel + "נבחרו N".
 * Replaces the screen's search/filter bar while a list is in selection mode.
 */
export default function MobileSelectionHeader({
  count,
  busy,
  onCancel,
  testId,
}: {
  count: number
  busy: boolean
  onCancel: () => void
  testId: string
}) {
  return (
    <div
      data-testid={testId}
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
