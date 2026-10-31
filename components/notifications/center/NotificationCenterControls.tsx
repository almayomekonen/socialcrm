/**
 * The center's two list controls — "mark all read" above the list and "load
 * more" below it — shared by the desktop and phone lists, which differ only in
 * size (the phone's are 44px touch targets).
 */

export function MarkAllReadBar({ onClick, mobile = false }: { onClick: () => void; mobile?: boolean }) {
  return (
    <div className='flex items-center justify-end border-b px-3 py-2'>
      <button
        type='button'
        onClick={onClick}
        className={
          mobile
            ? 'flex min-h-11 items-center rounded px-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary'
            : 'rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary'
        }
      >
        סימון הכל כנקרא
      </button>
    </div>
  )
}

/** Recoverable by asking again, so after a failure the button stays and says so. */
export function LoadMoreButton({
  onClick,
  loading,
  failed,
  mobile = false,
}: {
  onClick: () => void
  loading: boolean
  failed: boolean
  mobile?: boolean
}) {
  return (
    <div className='border-t px-3 py-2 text-center'>
      <button
        type='button'
        onClick={onClick}
        disabled={loading}
        className={`${mobile ? 'flex min-h-11 w-full items-center justify-center ' : ''}rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary`}
      >
        {loading ? 'טוען...' : failed ? 'לא הצלחנו לטעון — נסה שוב' : 'הצג עוד'}
      </button>
    </div>
  )
}
