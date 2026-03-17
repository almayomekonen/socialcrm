'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import SelectFilterUserPromo from './SelectFilterUserPromo'
import dynamic from 'next/dynamic'

const ExportTable = dynamic(() => import('@/lib/table/export'), { ssr: false })

export type Props = {
  data: any
  promo: any
}

export default function PromoTable({ data, promo }: Props) {
  // -------------------------
  // HEADERS
  // -------------------------
  function promoHeaders() {
    if (!data?.length) return []
    const cols = Object.keys(data[0])
    return cols.map((col) => ({ key: col, label: col, format: col.includes('סכום') ? 'formatCurrency' : 'formatPrecent' }))
  }

  // -------------------------
  // TABLE
  // -------------------------
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(promoHeaders())

  const config = {
    columns,
    setColumns,
    data,
    state,
    setState,
    noCheckboxs: true,
    withIndex: true,
  } as unknown as ConfigT

  return (
    <>
      <div className='mb-8 grid'>
        <div className='flex justify-between items-end'>
          <div className='flex gap-4 items-end mb-2'>
            <Search config={config} />
            <ShowColumns config={config} />
            {promo.isPromoGrp ? null : <SelectFilterUserPromo data={data} setState={setState} />}
          </div>

          <div className='flex gap-4 items-end mb-2'>
            <ExportTable data={state} columns={columns} />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />
      </div>
    </>
  )
}
