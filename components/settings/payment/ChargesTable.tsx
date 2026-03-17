'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import Table, { ConfigT } from '@/lib/table'

export default function ChargesTable({ data }) {
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(headers)
  const tblId = 'ipsTable4135'

  function moreRows(client) {
    return (
      <td className='sticky left-0 z-10 bg-white'>
        <Btn size='small' lbl='הורדה' />
      </td>
    )
  }

  function moreHeads() {
    return <th className='sticky left-0 z-10 bg-gray-100'></th>
  }

  const config = {
    tblId,
    columns,
    setColumns,
    data,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: {},
  } as ConfigT

  return (
    <>
      <div className='grid'>
        {/* <div className='flex justify-between gap-2 mb-2 '>
          <div className='flex gap-2'>
            <Search config={config} />
            <ShowColumns config={config} />
          </div>
        </div> */}
        <Table config={config} tblCls='mb-0 rounded-b-none' />
      </div>
    </>
  )
}

export const headers = [
  { key: 'date', label: 'תאריך תשלום', format: 'formatDate' },
  { key: 'invoiceNum', label: "חשבונית מס'", format: 'formatDate' },
  { key: 'pkg', label: 'חבילה' },
  { key: 'amount', label: 'סכום', format: 'formatCurrency' },
  { key: 'status', label: 'סטטוס' },
]
