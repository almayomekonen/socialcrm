'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { type LeadFilters } from '@/modules/leads/filters'

/** Filtered-empty (data exists, the filters return 0) — never the system-empty first run (ux-guidelines.md §11). */
export default function LeadListFilteredEmpty({ filters }: { filters: LeadFilters }) {
  const t = useT()
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
      <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='magnifying-glass' type='reg' className='size-5 bg-gray-400' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-base font-bold text-ink'>{t('leads.mobile.empty.title')}</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>
          {filters.q ? t('leads.mobile.empty.noResults', { q: filters.q }) : t('leads.mobile.empty.noStatus')}
        </p>
      </div>
      <Link
        href={'/leads' as Route}
        className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {t('leads.mobile.empty.clear')}
      </Link>
    </div>
  )
}
