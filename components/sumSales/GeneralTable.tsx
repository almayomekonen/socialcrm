'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'

const ExportTable = dynamic(() => import('@/lib/table/export'), { ssr: false })
const Filter = dynamic(() => import('@/components/filter'), { ssr: false })

export default function GeneralTable({ data, tblPref, user, tblId, filterProps }) {
  const [state, setState] = useState(data)

  function headers() {
    const cols = Object.keys(data[0] || [])
    return cols.map((col) => ({ key: col, label: col, format: 'formatCurrency' }))
  }

  const [columns, setColumns] = useState(tblPref?.[tblId] || headers())

  const config = {
    tblId,
    columns,
    setColumns,
    data,
    state,
    setState,
    noCheckboxs: true,
    withIndex: true,
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
  } as ConfigT

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
