'use client'

import { useSearchParams } from 'next/navigation'
import FilterBtn from '../filter/FilterBtn'

export default function SalesNav({ user }) {
  const searchParams = useSearchParams()
  const rawFilter = searchParams.get('filter')

  let jsonObj = {}
  try { if (rawFilter) jsonObj = JSON.parse(rawFilter) } catch { /* keep empty filter */ }

  return (
    <div className='flex items-end justify-between py-1  border-b-2 unwrap wrap  sticky top-0 bg-gray z-500'>
      <h1 className='title -mt-1.5'>{`עסקאות`}</h1>
      <div className='flex gap-2'>
        <FilterBtn user={user} filter={jsonObj} />
      </div>
    </div>
  )
}
