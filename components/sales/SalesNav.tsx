'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import FilterBtn from '../filter/FilterBtn'
import { usePersistedActiveFilter } from '@/components/filter/usePersistedActiveFilter'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SalesNav({ user, isSystemEmpty = false }) {
  const t = useT()
  const searchParams = useSearchParams()
  const rawFilter = searchParams.get('filter')
  usePersistedActiveFilter(user?.id, usePathname(), rawFilter)

  let jsonObj = {}
  try { if (rawFilter) jsonObj = JSON.parse(rawFilter) } catch { /* keep empty filter */ }

  return (
    <div className='flex items-end justify-between py-1  border-b-2 unwrap wrap  sticky top-0 bg-gray z-500'>
      <h1 className='title -mt-1.5'>{t('deals.page.title')}</h1>
      <div className='flex gap-2'>
        {!isSystemEmpty && <FilterBtn user={user} filter={jsonObj} />}
      </div>
    </div>
  )
}
