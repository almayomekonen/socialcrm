'use client'

import MultiPie from '@/lib/charts/MultiPie'
import { redirect } from 'next/navigation'
import MeshuklalSchumPie from './MeshuklalSchumPie'
import dynamic from 'next/dynamic'
import { BRANCHES } from '@/types/lists'
const Filter = dynamic(() => import('@/components/filter'), { ssr: false })

const BRANCH_COLORS = {
  שירותים: 'blue',
  מוצרים: 'orange',
  קורסים: 'coral',
  מנויים: 'green',
  חבילות: 'yellow',
  ייעוץ: 'lightBlue',
  אחר: 'gray',
}

export default function SumSalesPie({ pieData, goalsAndTotals, rawFilter, filterProps }) {
  const pieSize = 80

  return (
    <>
      <Filter props={filterProps} key={JSON.stringify(filterProps?.rawFilter)} />

      <div className='flex items-stretch gap-2 mt-4'>
        <MeshuklalSchumPie data={pieData} rawFilter={rawFilter} goalsAndTotals={goalsAndTotals} />
      </div>

      <div className='flex items-stretch gap-2 flex-wrap mt-2'>
        {BRANCHES.map((branch) => {
          const branchData = pieData[branch] || []
          if (branchData.every((item) => item.value === 0)) return null

          const onClick = Object.fromEntries(
            branchData.map((item) => [item.name, () => redirectFilter(rawFilter, branch, null, item.name)]),
          )

          return (
            <MultiPie
              key={branch}
              className='w-fit'
              lbl={branch}
              data={[{ data: branchData, label: 'עסקאות' }]}
              color={BRANCH_COLORS[branch] || 'blue'}
              hideTooltip={true}
              size={pieSize}
              onClick={onClick}
            />
          )
        })}
      </div>
    </>
  )
}

export function redirectFilter(rawFilter, branch, prdctType, prdct) {
  rawFilter.branch = branch
  rawFilter.prdctType = prdctType ? (Array.isArray(prdctType) ? prdctType : [prdctType]) : []
  rawFilter.prdct = prdct ? (Array.isArray(prdct) ? prdct : [prdct]) : []

  redirect(`?filter=${JSON.stringify(rawFilter)}`)
}
