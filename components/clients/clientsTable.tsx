'use client'

import { useEffect, useState } from 'react'
import ExportTable from '@/lib/table/export'
import TableFooter from '../../lib/table/TableFooter'
import { ActionsMenu, DotsMenu, getActions, RANK_MAP, SelectClientGrpActions } from './funcs'
import { getLastMeaningfulEvent, getNextAction, getReturnContext } from './pipelineHelpers'
import { formatLeadSource, formatStatus, getHeaders, getPipelineHeaders } from './clientHeaders'
import SelectClientLists from './SelectClientLists'
import { useKeepTblScrollPos, useLeadPolling } from '@/lib/hooksNEvents'
import ClientFormPop from './ClientFormPop'
import ModalPop from '../../lib/modals/ModalPop'
import TransferSalesClient from './TransferSalesClient'
import { redirect, useSearchParams } from 'next/navigation'
import TransferClientForm from './TransferClientForm'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { Select } from '@/lib/form'
import { deleteLead, recordOutcome, searchContacts, searchLeads, updateLead } from '@/actions/clients'
import { api } from '@/lib/funcs'
import Table, { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'

export default function ClientsTable({ data, user, leads = false, compact = false }) {
  const [state, setState] = useState(data)
  const tblId = compact ? 'pipelineTable436' : leads ? 'leadsTable436' : 'clientsTable436'

  const [columns, setColumns] = useState(compact ? getPipelineHeaders() : (user?.tblPref?.[tblId] || getHeaders(leads)))

  const [pendingOutcomeId, setPendingOutcomeId] = useState<number | null>(null)
  const [curClient, setCurClient] = useState(null)
  const [openForm, setOpenForm] = useState(false)
  const [openTransferSalesForm, setOpenTransferSalesForm] = useState(false)
  const [openTransferClientForm, setOpenTransferClientForm] = useState(false)
  const searchParams = useSearchParams()
  const clientId = searchParams.get('clientId')

  useEffect(() => {
    setState((prev) => {
      const dataMap = new Map(data.map((l) => [l.id, l]))
      const prevIds = new Set(prev.map((l) => l.id))
      const updated = prev.map((l) => dataMap.get(l.id) ?? l)
      const newFromServer = data.filter((l) => !prevIds.has(l.id))
      return newFromServer.length > 0 ? [...newFromServer, ...updated] : updated
    })
  }, [data])

  useKeepTblScrollPos(tblId)
  const initialMaxId = data.length > 0 ? Math.max(...data.map((d) => d.id)) : 0
  useLeadPolling((newLeads) => {
    setState((prev) => {
      const existingIds = new Set(prev.map((c) => c.id))
      const fresh = newLeads.filter((l) => !existingIds.has(l.id))
      return fresh.length > 0 ? [...fresh, ...prev] : prev
    })
  }, leads && !compact, initialMaxId)
  function moreRows(client) {
    return (
      <td className='sticky left-0 z-10 bg-white'>
        <DotsMenu id='clientActions' onClick={() => setCurClient(client)} />
      </td>
    )
  }

  function moreHeads() {
    return <th className='sticky left-0 z-10 bg-gray-100 text-center'>פעולות</th>
  }

  function formatRank(rank, item) {
    const color = RANK_MAP[String(rank)]?.color
    return (
      <Select
        key={item.id}
        value={String(rank ?? '')}
        onChange={(e) => {
          const newRank = Number(e.target.value)
          const newLeadBool = newRank <= 4
          api(updateLead, [{ id: item.id, rank: newRank, lead: newLeadBool }], 'שלב עודכן')
          // remove from this tab if stage moved to the other tab
          if (leads !== newLeadBool) setState((prev) => prev.filter((l) => l.id !== item.id))
            else {
              setState((prev) =>
                prev.map((l) =>
                  l.id === item.id
                    ? { ...l, rank: newRank, lead: newLeadBool }
                    : l
                )
              )
              if (compact) setPendingOutcomeId(item.id)
            }
        }}
        options={[
          { id: '1', name: 'חדש' },
          { id: '2', name: 'דיברתי' },
          { id: '3', name: 'בשיחה' },
          { id: '4', name: 'מתעניין' },
          { id: '5', name: 'סגור' },
          { id: '6', name: 'אבוד' },
        ]}
        placeholder='שלב'
        required={false}
        className='h-10 w-full rounded-md border bg-white disabled:opacity-50 border-gray-200 focus:outline-blue-200 pe-8 ps-2 min-w-24 border-s-[3px]'
        style={{ borderInlineStartColor: color }}
      />
    )
  }

  function handleOutcome(item, outcome: 'talked' | 'no-answer' | 'snooze') {
    setPendingOutcomeId(null)
    const now = new Date().toISOString()
    setState((prev) => prev.map((l) => l.id === item.id ? { ...l, lastActivityAt: now } : l))
    const msg = outcome === 'talked' ? 'נרשמה שיחה' : outcome === 'no-answer' ? 'לא ענה — נרשם' : 'נדחה — נרשם'
    api(recordOutcome, [item.id, outcome], msg)
  }

  function formatName(name, obj) {
    if (!compact) return <p>{name}</p>

    if (pendingOutcomeId === obj.id) {
      return (
        <div>
          <p className='font-semibold text-sm'>{name}</p>
          <div className='flex gap-1 mt-1'>
            <button type='button' onClick={() => handleOutcome(obj, 'talked')} className='text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700'>דיברתי</button>
            <button type='button' onClick={() => handleOutcome(obj, 'no-answer')} className='text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700'>לא ענה</button>
            <button type='button' onClick={() => handleOutcome(obj, 'snooze')} className='text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600'>לדחות</button>
          </div>
        </div>
      )
    }

    const returnCtx = getReturnContext(obj)
    const action = getNextAction(obj)
    const rankColor = RANK_MAP[String(obj.rank)]?.color
    const isUrgent = action.startsWith('דחוף:')
    const subLabel = returnCtx || action
    const subCls = returnCtx
      ? 'text-xs text-gray-500 font-medium'
      : `text-xs ${isUrgent ? 'font-semibold' : ''}`
    return (
      <div>
        <p className='font-semibold'>{name}</p>
        {subLabel && (
          <p
            className={subCls}
            style={!returnCtx && rankColor ? { color: rankColor } : undefined}
          >
            {subLabel}
          </p>
        )}
      </div>
    )
  }

  function formatPriority(priority) {
    if (priority === 1) return <span className='text-xs font-bold text-red-500'>1</span>
    if (priority === 2) return <span className='text-xs font-semibold text-orange-400'>2</span>
    return <span className='text-xs text-gray-400'>{priority}</span>
  }

  function formatUpdatedAt(_, item) {
    const lastEvent = getLastMeaningfulEvent(item)
    const diffHours = (Date.now() - lastEvent.getTime()) / (1000 * 60 * 60)
    const diffDays = Math.floor(diffHours / 24)
    const text = diffHours < 1
      ? 'לפני פחות משעה'
      : diffHours < 24
      ? `לפני ${Math.floor(diffHours)} שעות`
      : diffDays === 1
      ? 'ממתין יום'
      : `ממתין ${diffDays} ימים`
    const cls = diffHours < 24 ? 'text-gray-400' : diffHours < 48 ? 'text-yellow-600 font-medium' : 'text-red-600 font-semibold'
    return <span className={`text-xs whitespace-nowrap ${cls}`}>{text}</span>
  }

  const config = {
    tblId,
    columns,
    setColumns,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: { formatName, formatRank, formatStatus, formatLeadSource, formatUpdatedAt, formatPriority },
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
        <div className='flex justify-between gap-2 mb-2 items-end'>
          {!compact && (
            <div className='flex gap-0 items-end'>
              <SelectSearch
                options={[]}
                show='details'
                selected={clientId}
                val='id'
                inputCls='w-52 rounded-e-none'
                searchFunc={leads ? searchLeads : searchContacts}
                onSelectOpt={getSelectedClient}
              />
              <Btn variant='outline' size='icon' icon='eraser' href='?' scroll={false} className='rounded-s-none border-s-0' />
            </div>
          )}

          <div className='flex gap-2 items-end ms-auto'>
            {!compact && <ShowColumns config={config} />}
            {!compact && <SelectClientGrpActions user={user} />}
            {!compact && <SelectClientLists />}
            {!compact && <ExportTable data={state} columns={columns} />}
            <Btn lbl='ליד חדש' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />
        {state.length === 0 && (
          <div className='text-center py-16 border border-t-0 rounded-b-lg bg-white'>
            <p className='text-xl font-semibold mb-2'>אין עדיין לידים</p>
            <p className='text-gray-500 mb-4'>הוסף ליד ראשון כדי להתחיל</p>
          </div>
        )}
        {!compact && <TableFooter />}
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
        {curClient?.phone && (
          <>
            <div>
              <div className='h-px bg-gray-200 w-full' />
              <Btn variant='simple' size='simple' lbl='התקשר' onClick={() => window.location.href = `tel:${curClient.phone}`} />
            </div>
            <div>
              <div className='h-px bg-gray-200 w-full' />
              <Btn variant='simple' size='simple' lbl='WhatsApp' onClick={() => window.open(`https://wa.me/972${curClient.phone.replace(/\D/g, '').replace(/^0/, '')}`, '_blank')} />
            </div>
          </>
        )}
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
                    case 'העברת ליד לנציג אחר':
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
        <div>
          <div className='h-px bg-gray-200 w-full' />
          <Btn
            variant='simple'
            size='simple'
            lbl='מחיקה'
            className='text-red-600 hover:bg-red-600'
            onClick={async () => {
              if (!confirm(`האם למחוק ליד ${curClient?.name}?`)) return
              const res = await api(deleteLead, curClient.id)
              if (res?.err) {
                alert('לא ניתן למחוק ליד עם מכירות, העבר את המכירות ונסה שוב')
                return
              }
              setState((prev) => prev.filter((c) => c.id !== curClient.id))
            }}
          />
        </div>
      </ActionsMenu>
    </>
  )
}



