import type { CenterFilters } from '@/modules/notifications/center'

/**
 * The calm empty state (ux-guidelines §4). Which sentence depends on WHY the list
 * is empty: nothing has arrived, or a filter is hiding what has. Telling someone
 * with a filter on that they have no notifications would simply be false.
 */
export default function NotificationCenterEmpty({ filters }: { filters: CenterFilters }) {
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
