'use client'

import { useState } from 'react'
import ExportTable from '@/lib/table/export'
import TableFooter from '../../lib/table/TableFooter'
import { ActionsMenu, DotsMenu, FormatRank, getActions, SelectClientGrpActions } from './funcs'
import SelectClientLists from './SelectClientLists'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import ClientFormPop from './ClientFormPop'
import ModalPop from '../../lib/modals/ModalPop'
import TransferSalesClient from './TransferSalesClient'
import { redirect, useSearchParams } from 'next/navigation'
import TransferClientForm from './TransferClientForm'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { searchClients, searchLeads } from '@/actions/clients'
import Table, { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'

export default function ClientsTable({ data, user, leads = false }) {
  const [state, setState] = useState(data)
  const tblId = leads ? 'leadsTable435' : 'clientsTable435'

  const [columns, setColumns] = useState(user?.tblPref?.[tblId] || getHeaders(leads))

  const [curClient, setCurClient] = useState(null)
  const [openForm, setOpenForm] = useState(false)
  const [openTransferSalesForm, setOpenTransferSalesForm] = useState(false)
  const [openTransferClientForm, setOpenTransferClientForm] = useState(false)
  const searchParams = useSearchParams()
  const clientId = searchParams.get('clientId')

  useKeepTblScrollPos(tblId)
  function moreRows(client) {
    return (
      <td className='sticky left-0 z-10 bg-white'>
        <DotsMenu id='clientActions' onClick={() => setCurClient(client)} />
      </td>
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
    funcs: { formatName, formatRank, formatStatus },
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
  } as ConfigT

  function getSelectedClient(client) {
    const currentParams = new URLSearchParams(searchParams.toString())
    currentParams.set('clientId', client.id)
    currentParams.set('clientDetails', client.details)
    redirect(('?' + currentParams.toString()) as any)
  }

  return (
    <>
      <div className='grid'>
        <div className='flex justify-between gap-2 mb-2 items-end '>
          <div className='flex gap-0 items-end'>
            <SelectSearch
              options={[]}
              show='details'
              selected={clientId}
              val='id'
              inputCls='w-52 rounded-e-none'
              searchFunc={leads ? searchLeads : searchClients}
              onSelectOpt={getSelectedClient}
            />
            <Btn variant='outline' size='icon' icon='eraser' href='?' scroll={false} className='rounded-s-none border-s-0' />
          </div>

          <div className='flex gap-2 items-end'>
            <ShowColumns config={config} />
            <SelectClientGrpActions user={user} />
            <SelectClientLists />
            <ExportTable data={state} columns={columns} />
            <Btn lbl='לקוח חדש' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
          </div>
        </div>
        <Table config={config} tblCls='mb-0 rounded-b-none' />
        {state.length === 0 && (
          <div className='text-center py-16 border border-t-0 rounded-b-lg bg-white'>
            <p className='text-xl font-semibold mb-2'>{leads ? 'אין עדיין לידים' : 'אין עדיין לקוחות'}</p>
            <p className='text-gray-500 mb-4'>{leads ? 'הוסף ליד ראשון כדי להתחיל' : 'הוסף לקוח חדש כדי להתחיל'}</p>
            <Btn lbl={leads ? 'הוספת ליד חדש' : 'הוספת לקוח חדש'} icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
          </div>
        )}
        <TableFooter />
      </div>

      <ModalPop open={openForm} pos='middle' onClose={() => (setCurClient(null), setOpenForm(false))}>
        <ClientFormPop client={curClient} />
      </ModalPop>

      <ModalPop open={openTransferClientForm} pos='middle' onClose={() => (setCurClient(null), setOpenTransferClientForm(false))}>
        <TransferClientForm client={curClient} />
      </ModalPop>

      <ModalPop open={openTransferSalesForm} pos='middle' onClose={() => (setCurClient(null), setOpenTransferSalesForm(false))}>
        <TransferSalesClient client={curClient} />
      </ModalPop>

      <ActionsMenu id='clientActions'>
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
                    case 'העברת מכירות ללקוח אחר':
                      setOpenTransferSalesForm(true)
                      break
                    case 'העברת לקוח לנציג אחר':
                      setOpenTransferClientForm(true)
                      break
                    default:
                      action.func()
                  }
                }}
              />
            ) : (
              <Btn variant='simple' size='simple' lbl={lbl} />
            )}
          </div>
        ))}
      </ActionsMenu>
    </>
  )
}

export function getHeaders(leads) {
  const headers = [
    { key: 'rank', label: 'סיווג', format: 'formatRank' },
    { key: 'name', label: 'שם מלא', format: 'formatName' },
    { key: 'idNum', label: 'ת"ז' },
    { key: 'status', label: 'פעילות', format: 'formatStatus' },
    { key: 'userName', label: 'נציג' },
    { key: 'handlerName', label: 'אחראי' },
    { key: 'phone', label: 'מספר טלפון' },
    { key: 'email', label: 'מייל' },
    { key: 'leadSource', label: 'מקור' },
    // { key: 'updatedAt', label: 'תאריך פעילות אחרון', format: 'formatDate' },
  ]
  if (leads) {
    headers.push(
      { key: 'masleka', label: 'ערוץ א' },
      { key: 'harHabituach', label: 'ערוץ ב' },
      { key: 'polisot', label: 'מוצרים פעילים' },
    )
  }
  return headers
}

function formatStatus(status) {
  return <p>{status ? 'פעיל' : 'לא פעיל'}</p>
}

function formatName(name, obj) {
  return (
    // <Link href={`/clients/${obj.id}/tasks`} className='underline font-bold'>
    //   {name}
    // </Link>
    <p>{name}</p>
  )
}
function formatRank(rank) {
  return <FormatRank rank={rank} />
}
