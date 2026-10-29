'use client'

import { isMngr } from '@/types/roles'
import { Route } from 'next'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import FilterBtn from '@/components/filter/FilterBtn'
import { usePersistedActiveFilter } from '@/components/filter/usePersistedActiveFilter'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SumSalesNav({
  user,
  showAgents = false,
  showAds = false,
}: {
  user: any
  showAgents?: boolean
  /** Ad performance tab: admin + rollout gate, resolved server-side by the layout. */
  showAds?: boolean
}) {
  const t = useT()
  const pathname = usePathname()
  // The sales filter does not apply to ad performance; showing it there would imply it does.
  const onAds = pathname === '/sum_sales/ads'

  const searchParams = useSearchParams()
  const rawFilter = searchParams.get('filter')
  usePersistedActiveFilter(user?.id, pathname, rawFilter)

  const filter = rawFilter ? '?filter=' + rawFilter : ''

  let jsonObj = {}
  try { if (rawFilter) jsonObj = JSON.parse(rawFilter) } catch { /* keep empty filter */ }

  if (!user) return null

  return (
    <div className='flex items-end justify-between py-1 unwrap wrap  border-b-2 sticky top-0 bg-gray z-500 '>
      <div className='flex -mb-1 overflow-x-auto '>
        <div className='flex gap-0 flex-nowrap'>
          <SimpleLink href={`/sum_sales${filter}`} lbl={t('performance.nav.summary')} />
          {isMngr(user?.role) && showAgents && (
            <SimpleLink href={`/sum_sales/agents${filter}`} lbl={t('performance.nav.reps')} />
          )}
          <SimpleLink href={`/sum_sales/months${filter}`} lbl={t('performance.nav.months')} />
          {showAds && <SimpleLink href='/sum_sales/ads' lbl={t('performance.nav.ads')} />}
        </div>
      </div>

      {!onAds && <FilterBtn user={user} filter={jsonObj} />}
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
