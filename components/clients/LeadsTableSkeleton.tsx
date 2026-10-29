'use client'

import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor, regionAttrs } from '@/lib/i18n/config'

/**
 * Presentational loading chrome for /leads and /clients route segments.
 * Used only by route `loading.tsx` — never wired into hydrated ClientsTable.
 * A client component only to read the interface language from the layout's
 * provider (the route's loading UI renders inside it).
 */
export default function LeadsTableSkeleton({ withStatusTabs = true }: { withStatusTabs?: boolean }) {
  const t = useT()
  return (
    <div
      className='flex min-h-0 flex-1 flex-col'
      dir={dirFor(t.locale)}
      {...regionAttrs(t.locale)}
      aria-busy='true'
      data-testid='leads-route-skeleton'
    >
      <span className='sr-only' role='status'>
        {t('leads.empty.loading')}
      </span>

      {withStatusTabs && (
        <div className='mb-3 flex gap-1 border-b border-gray-200 shrink-0' aria-hidden='true'>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className='flex items-center gap-1.5 px-4 py-2'>
              <span className='size-2 shrink-0 rounded-full bg-gray-200' />
              <span className='h-3 w-12 rounded bg-gray-100' />
              <span className='h-4 w-5 rounded-full bg-gray-100' />
            </div>
          ))}
        </div>
      )}

      <div className='mb-2 flex items-end justify-between gap-2 shrink-0' aria-hidden='true'>
        <div className='flex items-end gap-0'>
          <div className='h-10 w-52 rounded-e-none rounded-s-md border border-gray-200 bg-gray-50' />
          <div className='size-10 rounded-s-none rounded-e-md border border-s-0 border-gray-200 bg-gray-50' />
        </div>
        <div className='flex gap-2'>
          <div className='h-10 w-24 rounded-md bg-gray-100' />
          <div className='h-10 w-28 rounded-md bg-gray-100' />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-hidden rounded-md border border-gray-200 bg-white' aria-hidden='true'>
        <table className='w-full table-fixed'>
          <thead>
            <tr className='bg-gray-100 text-start'>
              {['w-8', 'w-1/5', 'w-1/6', 'w-1/6', 'w-1/5', 'w-1/6'].map((w, i) => (
                <th key={i} className={`px-3 py-2.5 ${w}`}>
                  <div className='h-3 w-full max-w-[5rem] rounded bg-gray-200' />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, row) => (
              <tr key={row} className='border-t border-gray-100'>
                {Array.from({ length: 6 }).map((__, col) => (
                  <td key={col} className='px-3 py-3'>
                    <div
                      className={`h-3 rounded bg-gray-100 ${col === 1 ? 'w-3/4' : col === 0 ? 'w-4' : 'w-1/2'}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
