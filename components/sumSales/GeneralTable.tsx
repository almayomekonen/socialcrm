'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'
import { useT } from '@/lib/i18n/I18nProvider'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { dealCompanyLabel, reportMonthLabel } from '@/lib/deals/labels'
import { formatCurrency } from '@/lib/funcs'
import { reportColumnLabel } from './reportColumns'

const ExportTable = dynamic(() => import('@/lib/table/export'), { ssr: false })
const Filter = dynamic(() => import('@/components/filter'), { ssr: false })

/** Report columns whose CELLS are stored Hebrew values → their display-only label outside Hebrew. */
const VALUE_FORMAT: Record<string, string> = { חודש: 'reportMonth', חברה: 'reportCompany' }

export default function GeneralTable({ data, tblPref, user, tblId, filterProps }) {
  const t = useT()
  const locale = t.locale
  const safeData = Array.isArray(data) ? data : []
  const [state, setState] = useState<any[]>(safeData)

  function headers() {
    const cols = Object.keys(safeData[0] || {})
    return cols.map((col) => ({ key: col, label: col, format: 'formatCurrency' }))
  }

  const [columns, setColumns] = useState(tblPref?.[tblId] || headers())
  // Headers by response KEY in the interface language; stored columns (and the export) keep the keys as labels.
  const localized = useLocalizedColumns(columns, setColumns, (next) => saveTblPref(tblId, next), reportColumnLabel)
  const displayColumns = useMemo(
    () => (locale === 'he' ? localized.columns : localized.columns.map((c) => (VALUE_FORMAT[c.key] ? { ...c, format: VALUE_FORMAT[c.key] } : c))),
    [localized.columns, locale],
  )

  const config = {
    tblId,
    columns: displayColumns,
    setColumns: localized.setColumns,
    data: safeData,
    state,
    setState,
    noCheckboxs: true,
    withIndex: true,
    ...(locale === 'he'
      ? {}
      : {
          funcs: {
            // Same as `formatCurrency` for the numbers; the month / company cells are labelled.
            reportMonth: (value) => reportMonthLabel(value, locale),
            reportCompany: (value) => formatCurrency(dealCompanyLabel(value, locale) as never),
          },
        }),
    getColumns(columns) {
      localized.save(columns as unknown as Parameters<typeof localized.save>[0])
    },
  } as ConfigT

  if (safeData.length === 0) {
    return (
      <div className='flex items-center justify-center h-64 text-gray-400'>
        {t('performance.report.empty')}
      </div>
    )
  }

  return (
    <>
      <div className='my-8 grid'>
        <div className='flex justify-between'>
          <div className='flex gap-4 items-end mb-2'>
            <Search config={config} />
            {/* <FilterBtn user={user} /> */}
          </div>

          <div className='flex gap-2 items-end mb-2'>
            <ShowColumns config={config} />
            <ExportTable data={state} columns={columns} />
          </div>
        </div>

        <Table config={config} />
      </div>

      <Filter props={filterProps} key={JSON.stringify(filterProps?.rawFilter)} />
    </>
  )
}
