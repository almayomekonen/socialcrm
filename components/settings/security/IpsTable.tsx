'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

/** Headers in the interface language (Hebrew: the constant below itself, unchanged). */
function headersFor(t: Translator) {
  if (t.locale === 'he') return headers
  return [
    { key: 'device', label: t('settings.account.security.col.device') },
    { key: 'ip', label: t('settings.account.security.col.ip') },
    { key: 'at', label: t('settings.account.security.col.at'), format: 'formatDateTime' },
  ]
}

export default function IpsTable({ data }) {
  const t = useT()
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(() => headersFor(t))
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
    // Outside Hebrew the sign-in time is shown in the business time zone (lib/leads/leadDate); Hebrew keeps the table's own formatter.
    funcs: t.locale === 'he' ? {} : { formatDateTime: (value) => formatLeadDateTime(t.locale, value) },
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
  { key: 'device', label: 'מכשיר / דפדפן' },
  { key: 'ip', label: 'כתובת IP' },
  { key: 'at', label: 'מתי', format: 'formatDateTime' },
]
