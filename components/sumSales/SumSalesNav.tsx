'use client'

import { isMngr } from '@/types/roles'
import { Route } from 'next'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import FilterBtn from '@/components/filter/FilterBtn'

export default function SumSalesNav({ user }) {
  const pathname = usePathname()

  const searchParams = useSearchParams()
  const rawFilter = searchParams.get('filter')

  const filter = rawFilter ? '?filter=' + rawFilter : ''

  let jsonObj = {}
  try { if (rawFilter) jsonObj = JSON.parse(rawFilter) } catch { /* keep empty filter */ }
  return (
    <div className='flex items-end justify-between py-1 unwrap wrap  border-b-2 sticky top-0 bg-gray z-500 '>
      <div className='flex -mb-1 overflow-x-auto '>
        <div className='flex gap-0 flex-nowrap'>
          <SimpleLink href={`/sum_sales${filter}`} lbl='סיכום' />
          {isMngr(user.role) && (
            <>
              <SimpleLink href={`/sum_sales/agents${filter}`} lbl='נציגים' />
              <SimpleLink href={`/sum_sales/teams${filter}`} lbl='צוותים' />
            </>
          )}
          <SimpleLink href={`/sum_sales/months${filter}`} lbl='חודשים' />
          <SimpleLink href={`/sum_sales/companies${filter}`} lbl='ספקים' />
        </div>
      </div>

      <FilterBtn user={user} filter={jsonObj} />
    </div>
  )
}

function SimpleLink({ href, lbl }: { href: Route; lbl: string }) {
  const pathname = usePathname()
  const isActive = pathname === href.split('?')[0]

  const className = 'font-bold border-b-2 text-solid border-solid pointer-events-none'

  return (
    <Link href={href} className={` px-6 py-1  ${isActive ? className : ''}`}>
      {lbl}
    </Link>
  )
}
