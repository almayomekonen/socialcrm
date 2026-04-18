'use client'

import { useState, useEffect, useRef } from 'react'
import ExportTable from '@/lib/table/export'
import TableFooter from '../../lib/table/TableFooter'
import { ActionsMenu, DEAL_ACTION_LABELS, DotsMenu, getActions, SelectClientGrpActions } from './funcs'
import SelectClientLists from './SelectClientLists'
import { useKeepTblScrollPos, useLeadPolling } from '@/lib/hooksNEvents'
import ClientFormPop from './ClientFormPop'
import ModalPop from '../../lib/modals/ModalPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'
import UploadClientData from '@/components/settings/UploadClientData'
import { redirect, useSearchParams } from 'next/navigation'
import TransferClientForm from './TransferClientForm'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { deleteLead, searchContacts, searchLeads, updateLead } from '@/actions/clients'
import { toast } from '@/lib/toast'
import { api } from '@/lib/funcs'
import Table, { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'

export default function ClientsTable({ data, user, leads = false, globalLatestUpdatedAt = '', formProps = null }) {
  const [liveLeads, setLiveLeads] = useState<any[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())
  const [activeTab, setActiveTab] = useState('new')
  const mergedState = [
    ...liveLeads,
    ...data.filter((d) => !liveLeads.some((l) => l.id === d.id) && !deletedIds.has(d.id)),
  ]
  const filteredData = leads
    ? mergedState.filter((lead) => lead.status === activeTab)
    : mergedState
  const tblId = leads ? 'leadsTable435' : 'clientsTable435'

  const validHeaders = getHeaders(leads)
  const validKeys = new Set(validHeaders.map((h) => h.key))
  const savedPref = user?.tblPref?.[tblId]?.filter((col) => validKeys.has(col.key))
  const [columns, setColumns] = useState(savedPref?.length ? savedPref : validHeaders)

  const [curClient, setCurClient] = useState(null)
  const [openForm, setOpenForm] = useState(false)
  const [openTransferClientForm, setOpenTransferClientForm] = useState(false)
  const [openSaleForm, setOpenSaleForm] = useState(false)
  const [openUpload, setOpenUpload] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const [newLeadsCount, setNewLeadsCount] = useState(0)
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])
  const searchParams = useSearchParams()
  const clientId = searchParams.get('clientId')
  const clientDetails = searchParams.get('clientDetails')

  useKeepTblScrollPos(tblId)
  useLeadPolling((polledLeads) => {
    setLiveLeads((prev) => {
      const prevMap = new Map(prev.map((c) => [c.id, c]))
      const existingIds = new Set([
        ...prev.map((p) => p.id),
        ...dataRef.current.map((d) => d.id),
      ])

      let newCount = 0
      const next = [...prev]

      for (const lead of polledLeads) {
        if (prevMap.has(lead.id)) {
          // Update an existing liveLeads entry in-place
          const idx = next.findIndex((r) => r.id === lead.id)
          next[idx] = lead
        } else {
          // Not yet in liveLeads — prepend (new lead or update promoted from data)
          if (!existingIds.has(lead.id)) newCount++
          next.unshift(lead)
        }
      }

      if (newCount > 0) setNewLeadsCount(newCount)

      return next
    })
  }, leads, globalLatestUpdatedAt)

  useEffect(() => {
    if (newLeadsCount > 0) {
      toast('success', newLeadsCount === 1 ? 'ליד חדש הגיע' : `${newLeadsCount} לידים חדשים הגיעו`)
      setNewLeadsCount(0)
    }
  }, [newLeadsCount])

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

  function formatStatus(status, obj) {
    const isUpdating = updatingId === obj.id
    const s = STATUS_STYLES[status ?? 'new'] || STATUS_STYLES.new
    return (
      <Select
        options={STATUS_OPTIONS}
        val='value'
        show='label'
        value={status ?? 'new'}
        required={false}
        className={`min-w-28 ${s.bg} ${s.text} ${s.border} ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}
        onChange={async (e) => {
          const newStatus = e.target.value
          const snapshotLiveLeads = liveLeads
          const sourceLead = liveLeads.find((r) => r.id === obj.id) ?? data.find((d) => d.id === obj.id)
          setLiveLeads((prev) => {
            const exists = prev.some((r) => r.id === obj.id)
            if (exists) return prev.map((row) => (row.id === obj.id ? { ...row, status: newStatus } : row))
            return sourceLead ? [{ ...sourceLead, status: newStatus }, ...prev] : prev
          })
          setUpdatingId(obj.id)
          const res = await api(updateLead, { id: obj.id, status: newStatus }, 'סטטוס עודכן')
          setUpdatingId(null)
          if (!res || res?.err) {
            setLiveLeads(snapshotLiveLeads)
          } else {
            setHighlightedId(obj.id)
            setTimeout(() => setHighlightedId(null), 2500)
          }
        }}
      />
    )
  }

  const emptyState = filteredData.length === 0 ? (
    <div className='text-center py-8 flex flex-col items-center gap-4'>
      {mergedState.length === 0 ? (
        <>
          <p className='text-lg font-semibold'>אין עדיין נתונים</p>
          <p className='text-sm text-gray-500'>אפשר להתחיל על ידי יצירת ליד או העלאת קובץ</p>
          <div className='flex gap-3 justify-center'>
            <Btn lbl='הוסף ליד' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
            <Btn lbl='העלה לידים' variant='soft' onClick={() => setOpenUpload(true)} />
          </div>
        </>
      ) : (
        <p className='text-sm text-gray-500'>אין לידים בסטטוס זה</p>
      )}
    </div>
  ) : null

  const config = {
    tblId,
    columns,
    setColumns,
    state: filteredData,
    setState: setLiveLeads,
    moreHeads,
    moreRows,
    funcs: { formatName, formatStatus, formatLeadSource, formatLeadStatus, formatState, formatNextAction },
    addTrCls: (item) => item.id === highlightedId ? 'bg-green-50 transition-all duration-500' : '',
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
    emptyState,
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
        {leads && (
          <div className='flex gap-1 mb-3 border-b border-gray-200' dir='rtl'>
            {Object.entries(STATUS_STYLES).map(([key, { label, dot, text, bg, border }]) => {
              const count = mergedState.filter((l) => l.status === key).length
              const isActive = activeTab === key
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 -mb-px transition-colors
                    ${isActive
                      ? `${bg} ${text} ${border} bg-white`
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                  {label}
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium
                    ${isActive ? `${text} opacity-70` : 'bg-gray-100 text-gray-500'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className='flex justify-between gap-2 mb-2 items-end '>
          <div className='flex gap-0 items-end'>
            <SelectSearch
              options={[]}
              show='details'
              selected={clientId}
              val='id'
              inputCls='w-52 rounded-e-none'
              searchFunc={leads ? searchLeads : searchContacts}
              onSelectOpt={getSelectedClient}
              initShow={clientDetails}
            />
            <Btn variant='outline' size='icon' icon='eraser' href='?' scroll={false} className='rounded-s-none border-s-0' />
          </div>

          <div className='flex gap-2 items-end'>
            <ShowColumns config={config} />
            <SelectClientGrpActions user={user} />
            <SelectClientLists />
            <ExportTable data={mergedState} columns={columns} />
            <Btn lbl='ליד חדש' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
          </div>
        </div>
        <Table config={config} tblCls='mb-0' />
        <TableFooter />
      </div>

      <ModalPop open={openForm} pos='middle' onClose={() => (setCurClient(null), setOpenForm(false))}>
        <ClientFormPop client={curClient} onClose={() => (setCurClient(null), setOpenForm(false))} />
      </ModalPop>

      <ModalPop open={openTransferClientForm} pos='middle' onClose={() => (setCurClient(null), setOpenTransferClientForm(false))}>
        <TransferClientForm client={curClient} />
      </ModalPop>

      <ModalPop open={openUpload} pos='middle' onClose={() => setOpenUpload(false)}>
        <UploadClientData />
      </ModalPop>

      {formProps && (
        <ModalPop open={openSaleForm} onClose={() => (setCurClient(null), setOpenSaleForm(false))}>
          <SaleForm
            props={formProps}
            curSale={curClient ? ({ clientId: curClient.id, clientData: curClient.name } as any) : undefined}
            onClose={() => (setCurClient(null), setOpenSaleForm(false))}
          />
        </ModalPop>
      )}

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
        {Object.entries(getActions(curClient?.status)).map(([lbl, action]) => (
          <div key={lbl}>
            <div className='h-px bg-gray-200 w-full' />
            {action.func ? (
              <Btn
                variant='simple'
                size='simple'
                lbl={lbl}
                onClick={() => {
                  if (DEAL_ACTION_LABELS.includes(lbl)) {
                    setOpenSaleForm(true)
                    return
                  }
                  switch (lbl) {
                    case 'עריכה':
                      setOpenForm(true)
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
              setLiveLeads((prev) => prev.filter((c) => c.id !== curClient.id))
              setDeletedIds((prev) => new Set([...prev, curClient.id]))
            }}
          />
        </div>
      </ActionsMenu>
    </>
  )
}

export function getHeaders(leads) {
  const headers = [
    { key: 'name', label: 'שם מלא', format: 'formatName' },
    { key: 'phone', label: 'מספר טלפון' },
    { key: 'status', label: 'סטטוס', format: 'formatStatus' },
    { key: 'nextAction', label: 'פעולה הבאה', format: 'formatNextAction' },
    { key: 'leadSource', label: 'מקור', format: 'formatLeadSource' },
    { key: 'userName', label: 'נציג' },
    { key: 'handlerName', label: 'מנהל' },
    { key: 'email', label: 'מייל' },
  ]
  if (leads) {
    headers.push(
      { key: 'leadStatus', label: 'מצב ליד', format: 'formatLeadStatus' },
    )
  }
  return headers
}

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  new:       { label: 'חדש',     bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  contacted: { label: 'בטיפול',  bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-500' },
  interested:{ label: 'מעוניין', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  closed:    { label: 'סגור',    bg: 'bg-gray-100',  text: 'text-gray-600',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  lost:      { label: 'אבוד',    bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    dot: 'bg-red-500' },
}

const STATUS_OPTIONS = Object.entries(STATUS_STYLES).map(([value, { label }]) => ({ value, label }))

const SOURCE_STYLES: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  whatsapp: 'bg-green-100 text-green-700',
  instagram: 'bg-pink-100 text-pink-700',
  manual: 'bg-gray-100 text-gray-600',
}

function formatLeadSource(source) {
  const s = (source || 'manual').toLowerCase()
  const cls = SOURCE_STYLES[s] || 'bg-gray-100 text-gray-600'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>{source || 'manual'}</span>
}


function formatName(name, obj) {
  return (
    // <Link href={`/clients/${obj.id}/tasks`} className='underline font-bold'>
    //   {name}
    // </Link>
    <p>{name}</p>
  )
}
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status]
  if (!s) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}


function formatLeadStatus(_: unknown, obj: Record<string, unknown>) {
  return <StatusBadge status={obj.status as string} />
}

function getNextActionFromStatus(status: string | null): string | null {
  if (status === 'new') return 'התקשר עכשיו'
  if (status === 'contacted') return 'עקוב אחרי'
  if (status === 'interested') return 'סגור עסקה'
  return null
}

function formatState(_: unknown, obj: Record<string, unknown>) {
  return <StatusBadge status={obj.status as string} />
}

function formatNextAction(_: unknown, obj: Record<string, unknown>) {
  const nextAction = getNextActionFromStatus(obj.status as string | null)
  if (!nextAction) return null
  return <span className='text-xs font-medium text-gray-700'>{nextAction}</span>
}
