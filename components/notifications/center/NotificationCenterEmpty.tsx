'use client'

import type { CenterFilters } from '@/modules/notifications/center'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The calm empty state (ux-guidelines §4). Which sentence depends on WHY the list
 * is empty: nothing has arrived, or a filter is hiding what has. Telling someone
 * with a filter on that they have no notifications would simply be false.
 */
export default function NotificationCenterEmpty({ filters }: { filters: CenterFilters }) {
  const t = useT()
  const filtered = filters.unreadOnly || filters.category !== null
  return (
    <div className='rounded-lg border border-gray-200 bg-white px-4 py-12 text-center'>
      <p className='text-sm text-gray-700'>
        {t(filtered ? 'notifications.center.empty.filteredTitle' : 'notifications.center.empty.title')}
      </p>
      <p className='mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500'>
        {t(filtered ? 'notifications.center.empty.filteredBody' : 'notifications.panel.empty.body')}
      </p>
    </div>
  )
}
