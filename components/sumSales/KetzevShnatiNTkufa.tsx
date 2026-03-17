import { formatCurrency, formatRoundCurrency, round } from '@/lib/funcs'
import React from 'react'

export default function KetzevShnatiNTkufa({ ketzevShnati }) {
  return (
    <div className='text-sm'>
      <p className='mb-1 lg:mb-[9px] pb-1 border-b w-28 font-bold  '>קצב שנתי</p>

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
