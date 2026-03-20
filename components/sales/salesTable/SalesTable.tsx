'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { notesBtn, saleTableHeaders } from './saleHeaders'
import { getSaleDataToExport, saveReward, updateSaleStatus } from '@/actions/salesTbl'
import { saveTblPref } from '@/actions/global'
import { api } from '@/lib/funcs'
import { redirect } from 'next/navigation'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import TableFooter from '@/lib/table/TableFooter'
import { Select } from '@/lib/form'
import { STATUS_LIST } from '@/types/lists'
import { ActionsMenu, DotsMenu, getActions, SelectSalesGrpActions } from './funcs'
import GroupAction from './GroupAction'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { searchClients } from '@/actions/clients'
import Table, { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'

const ExportTable = dynamic(() => import('@/lib/table/export'), { ssr: false })

export type SaleTableProps = {
  props: {
    data: any[]
    params: any
    rawFilter: any
    user: any
    formProps: any
    setCurSale: (sale: any) => void
    setOpenForm: (open: boolean) => void
    curSale: any
    isSystemEmpty?: boolean
  }
}

export default function SalesTable({ props }: SaleTableProps) {
  const { data, params, rawFilter, user, formProps, setCurSale, setOpenForm, curSale, isSystemEmpty } = props
  const { isFav } = params
  const tblId = 'saleTable376'
  useKeepTblScrollPos(tblId)
  const [state, setState] = useState(data)

  const [columns, setColumns] = useState(user?.tblPref?.[tblId] || saleTableHeaders(user))

  if (isSystemEmpty) {
    return (
      <div className='text-center py-8 border rounded-lg bg-white flex flex-col items-center gap-4'>
        <p className='text-lg font-semibold'>עדיין אין לידים במערכת</p>
        <div className='flex gap-3 justify-center'>
          <Btn lbl='העלה לידים' variant='soft' href='/settings/self_edit?tab=upload' />
          <Btn lbl='הוסף ליד' icon='plus' onClick={() => (setOpenForm(true), setCurSale(null))} />
        </div>
      </div>
    )
  }

  function selectStatus(status, item) {
    return (
      <Select
        key={item.id}
        defaultValue={status}
        onChange={(e) => {
          api(updateSaleStatus, [item.id, e.target.value], 'סטטוס עודכן בהצלחה')
          const sale = data.find((i) => i.id === item.id)
          sale.status = e.target.value
          if (e.target.value === 'הופק') sale.saleDt = new Date()
          setState([...data])
        }}
        options={STATUS_LIST}
        className='min-w-28'
      />
    )
  }

  function formatReward(rwrd, obj) {
    return (
      <label className='flex flex-nowrap gap-2' key={obj.id}>
        <input
          type='checkbox'
          defaultChecked={rwrd}
          onChange={(e) => {
            api(saveReward, [obj.id, e.target.checked], 'תוגמל עודכן בהצלחה')
            const sale = data.find((i) => i.id === obj.id)
            sale.bonus = e.target.checked
            setState(data)
          }}
        />
        <p>תוגמל</p>
      </label>
    )
  }

  function moreRows(sale) {
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          <DotsMenu id='saleActions' onClick={() => setCurSale(sale)} />
        </td>
      </>
    )
  }

  function moreHeads() {
    return <th className='sticky left-0 z-10 bg-gray-100'>פעולות</th>
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
    funcs: { selectStatus, notesBtn, formatReward },
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
  } as ConfigT

  function getSelectedClient(client) {
    redirect(
      ('?filter=' +
        JSON.stringify({
          clientIds: [client.id],
          clientNames: [client.details],
          dateRange: 'כל התאריכים',
          action: 'הכל',
          status: ['הכל'],
        })) as any,
    )
  }
  return (
    <>
      <div className='my-8 grid'>
        <div className='flex justify-between gap-4 items-end'>
          <div className='flex gap-3 items-end mb-2'>
            <SelectSearch placeholder='חיפוש לקוח' show='details' searchFunc={searchClients} onSelectOpt={getSelectedClient} />
            <GroupAction isFav={isFav} />
          </div>

          <div className='flex gap-2 items-end mb-2'>
            <ShowColumns config={config} />
            <ExportTable dataToFetch={getSaleDataToExport} columns={columns} />
            <Btn lbl='הוספת מכירה' icon='plus' onClick={() => (setOpenForm(true), setCurSale(null))} className='ms-4' />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />
        {state.length === 0 && (
          <div className='text-center py-8 border border-t-0 rounded-b-lg bg-white flex flex-col items-center gap-3'>
            <p className='text-lg font-semibold'>לא נמצאו תוצאות עבור הסינון</p>
            <Btn lbl='נקה סינון' variant='soft' href='/' />
          </div>
        )}
        <TableFooter />
      </div>

      <ActionsMenu id='saleActions'>
        {Object.entries(getActions()).map(([lbl, action]) => (
          <div key={lbl}>
            <div className='h-px bg-gray-200 w-full' />
            {action.func ? (
              <Btn
                variant='simple'
                size='simple'
                lbl={lbl}
                onClick={() => {
                  switch (lbl) {
                    case 'עריכה':
                      setOpenForm(true)
                      break

                    default:
                      action.func(curSale, isFav)
                  }
                }}
              />
            ) : (
              <Btn variant='simple' lbl={lbl} />
            )}
          </div>
        ))}
      </ActionsMenu>
    </>
  )
}
