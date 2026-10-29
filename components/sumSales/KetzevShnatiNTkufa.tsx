import { formatCurrency, formatRoundCurrency, round } from '@/lib/funcs'
import React from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export default function KetzevShnatiNTkufa({ ketzevShnati }) {
  const t = useT()
  return (
    <div className='text-sm'>
      {/* Same header box as the MultiPie legend header (mb-2 pb-1 border-b), so both top-anchored columns share one header line and one row grid. */}
      <p className='mb-2 pb-1 border-b w-28 font-bold'>{t('performance.overview.annualPace')}</p>

      {/* Data rows */}
      {Object.entries(ketzevShnati).map(([category, value]: [string, any]) => {
        return (
          <div key={category} className='mb-2 flex flex-nowrap'>
            <div className='flex flex-row gap-4'>
              <div className='w-28 font-semibold'>{formatRoundCurrency(value)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
