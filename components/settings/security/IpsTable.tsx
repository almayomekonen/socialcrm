'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'

export default function IpsTable({ data }) {
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(headers)
  const tblId = 'ipsTable4135'

  //   function moreRows(client) {
  //     return <td className='sticky left-0 z-10 bg-white'></td>
  //   }

  //   function moreHeads() {
  //     return <th className='sticky left-0 z-10 bg-gray-100'>פעולות</th>
  //   }

  const config = {
    tblId,
    columns,
    setColumns,
    data,
    state,
    setState,
    // moreHeads,
    // moreRows,
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
  { key: 'ip', label: 'IP' },
  { key: 'date', label: 'תאריך התחברות', format: 'formatDate' },
]
