'use client'

import MultiPie from '@/lib/charts/MultiPie'
import { redirectFilter } from './SumSalesPie'
import GoalsAndTotals from '../sales/GoalsAndTotals'
import { useUser } from '@/lib/hooksNEvents'
import { getYearDaysPassed } from '@/lib/dates'
import KetzevShnatiNTkufa from './KetzevShnatiNTkufa'
import { BRANCHES } from '@/types/lists'
import { useT } from '@/lib/i18n/I18nProvider'
import { dealBranchLabel } from '@/lib/deals/labels'
import type { MessageKey } from '@/lib/i18n/translate'

/** Pie names are the keys `hideForPies` reads; their text comes from here. */
const PIE: Record<string, MessageKey> = { עמלה: 'performance.overview.pieCommission', הכנסה: 'performance.overview.pieIncome' }

export default function MeshuklalSchumPie({ data, goalsAndTotals, rawFilter, className = '' }) {
  const user = useUser()
  const t = useT()
  const display = {
    name: (name: string) => dealBranchLabel(name, t.locale),
    pie: (label: string) => (PIE[label] ? t(PIE[label]) : label),
    total: t('performance.overview.total'),
  }
  const { meshuklal = [], tfuca = [], cmsnPrdcts = {}, tfucaPrdcts = {} } = data || {}

  const ketzevShnati = {}
  const yearDaysPassed = getYearDaysPassed() || 1
  if (Array.isArray(tfuca)) {
    tfuca.forEach((item) => {
      ketzevShnati[item.name] = (item.value / yearDaysPassed) * 365
    })
  }

  const onClick = Object.fromEntries(
    BRANCHES.map((branch) => [branch, () => redirectFilter(rawFilter, branch, null, null)]),
  )

  return (
    <div className=' flex items-start gap-2 overflow-x-auto '>
      <div className='flex flex-nowrap items-start gap-0 bg-white px-6 py-4 rounded-lg border '>
        <MultiPie 
          className={`${className} w-fit  2xl:w-auto border-none p-0 rounded-none`}
          data={[
            {
              data: meshuklal,
              label: 'עמלה',
              tooltipInfo: { ...cmsnPrdcts },
            },
            {
              data: tfuca,
              label: 'הכנסה',
              tooltipInfo: { ...tfucaPrdcts },
            },
          ]}
          onClick={onClick}
          hideForPies={{
            הכנסה: { hidePercentages: true, hideTotal: true },
          }}
          lbl={t('performance.overview.compare')}
          display={display}
        />
        <KetzevShnatiNTkufa ketzevShnati={ketzevShnati} />
      </div>
      <GoalsAndTotals user={user} data={goalsAndTotals} />
    </div>
  )
}
