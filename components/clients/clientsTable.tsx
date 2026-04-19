'use client'

import { useState } from 'react'
import ExportTable from '@/lib/table/export'
import TableFooter from '../../lib/table/TableFooter'
import { ActionsMenu, DEAL_ACTION_LABELS, DotsMenu, getActions, SelectClientGrpActions } from './funcs'
import SelectClientLists from './SelectClientLists'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import ClientFormPop from './ClientFormPop'
import ModalPop from '../../lib/modals/ModalPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'
import UploadClientData from '@/components/settings/UploadClientData'
import { redirect, useSearchParams } from 'next/navigation'
import TransferClientForm from './TransferClientForm'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { deleteLead, searchContacts, searchLeads } from '@/actions/clients'
import { api } from '@/lib/funcs'
import { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'
import LeadStatusCell, { STATUS_STYLES } from './LeadStatusCell'
import LeadsTableView from './LeadsTableView'
import { useLeadsState } from './hooks/useLeadsState'
import { useLeadActions } from './hooks/useLeadActions'
import { useLeadSelection } from './hooks/useLeadSelection'

export default function ClientsTable({ data, user, leads = false, globalLatestUpdatedAt = '', formProps = null }) {
  const [activeTab, setActiveTab] = useState('new')
  const tblId = leads ? 'leadsTable435' : 'clientsTable435'

  const {
    setLiveLeads,
    setDeletedIds,
    setOptimisticStatuses,
    mergedState,
    filteredData,
  } = useLeadsState({ data, leads, activeTab, globalLatestUpdatedAt })

  const { updatingId, highlightedId, handleStatusChange } = useLeadActions({
    setActiveTab,
    setOptimisticStatuses,
  })

  const { selectedIds, handleBulkDelete } = useLeadSelection({
    leads,
    tblId,
    filteredData,
    activeTab,
    setLiveLeads,
    setDeletedIds,
  })

  const validHeaders = getHeaders(leads)
  const validKeys = new Set(validHeaders.map((h) => h.key))
  const savedPref = user?.tblPref?.[tblId]?.filter((col) => validKeys.has(col.key))
  const [columns, setColumns] = useState(savedPref?.length ? savedPref : validHeaders)

  const [curClient, setCurClient] = useState(null)
  const [openForm, setOpenForm] = useState(false)
  const [openTransferClientForm, setOpenTransferClientForm] = useState(false)
  const [openSaleForm, setOpenSaleForm] = useState(false)
  const [openUpload, setOpenUpload] = useState(false)

  const searchParams = useSearchParams()
  const clientId = searchParams.get('clientId')
  const clientDetails = searchParams.get('clientDetails')

  useKeepTblScrollPos(tblId)

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
    return (
      <LeadStatusCell
        status={status}
        obj={obj}
        updatingId={updatingId}
        onStatusChange={handleStatusChange}
      />
    )
  }

  const emptyState = filteredData.length === 0 ? (
    <div className='text-center py-8 flex flex-col items-center gap-4'>
      {mergedState.length === 0 ? (
        leads ? (
          <>
            <p className='text-lg font-semibold'>אין עדיין לידים</p>
            <p className='text-sm text-gray-500'>חבר פייסבוק או הוסף ליד ידנית</p>
            <div className='flex gap-3 justify-center'>
              <Btn lbl='הוסף ליד' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
              <Btn lbl='העלה לידים' variant='soft' onClick={() => setOpenUpload(true)} />
            </div>
          </>
        ) : (
          <>
            <p className='text-lg font-semibold'>אין עדיין נתונים</p>
            <p className='text-sm text-gray-500'>אפשר להתחיל על ידי יצירת ליד או העלאת קובץ</p>
            <div className='flex gap-3 justify-center'>
              <Btn lbl='הוסף ליד' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
              <Btn lbl='העלה לידים' variant='soft' onClick={() => setOpenUpload(true)} />
            </div>
          </>
        )
      ) : (
        (() => {
          const countByStatus = Object.keys(STATUS_STYLES).reduce(
            (acc, key) => ({ ...acc, [key]: mergedState.filter((l) => l.status === key).length }),
            {} as Record<string, number>,
          )
          // Non-actionable statuses (סגור / אבוד) — excluded from primary suggestion.
          const NON_ACTIONABLE = new Set(['closed', 'lost'])
          const actionableTop = Object.keys(STATUS_STYLES)
            .filter((k) => k !== activeTab && !NON_ACTIONABLE.has(k) && countByStatus[k] > 0)
            .sort((a, b) => countByStatus[b] - countByStatus[a])[0]
          // Fallback: first status with leads (even if non-actionable).
          const fallbackWithLeads = Object.keys(STATUS_STYLES).find(
            (k) => k !== activeTab && countByStatus[k] > 0,
          )
          const topStatus = actionableTop ?? fallbackWithLeads
          const firstWithLeads =
            Object.keys(STATUS_STYLES).find((k) => countByStatus[k] > 0) ?? topStatus
          return (
            <>
              <p className='text-sm text-gray-500'>אין לידים בסטטוס זה כרגע</p>
              {topStatus && (
                <div className='flex gap-3 justify-center'>
                  <Btn
                    lbl={`הצג לידים ב"${STATUS_STYLES[topStatus].label}" (${countByStatus[topStatus]})`}
                    onClick={() => setActiveTab(topStatus)}
                  />
                  <Btn
                    variant='outline'
                    lbl='הצג את כל הלידים'
                    onClick={() => firstWithLeads && setActiveTab(firstWithLeads)}
                  />
                </div>
              )}
              <p className='text-sm text-gray-600'>
                <button
                  type='button'
                  className='underline hover:text-gray-800'
                  onClick={() => (setOpenForm(true), setCurClient(null))}
                >
                  הוסף ליד ידנית
                </button>
                {' או '}
                <button
                  type='button'
                  className='underline hover:text-gray-800'
                  onClick={() => setOpenUpload(true)}
                >
                  העלה קובץ לידים
                </button>
              </p>
            </>
          )
        })()
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
        <LeadsTableView
          leads={leads}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          filteredData={filteredData}
          mergedState={mergedState}
          config={config}
        >
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
              {leads && selectedIds.length > 0 && (
                <Btn
                  variant='destructive'
                  icon='trash'
                  lbl={
                    selectedIds.length === filteredData.length
                      ? `מחק הכל (${selectedIds.length})`
                      : `מחק (${selectedIds.length})`
                  }
                  onClick={handleBulkDelete}
                />
              )}
              <ShowColumns config={config} />
              <SelectClientGrpActions user={user} />
              <SelectClientLists />
              <ExportTable data={mergedState} columns={columns} />
              <Btn lbl='ליד חדש' icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
            </div>
          </div>
        </LeadsTableView>
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
              if (res?.err || res?.error) {
                const reason = res?.reason
                const msg =
                  reason === 'has_sales'
                    ? 'לא ניתן למחוק ליד עם מכירות, העבר את המכירות ונסה שוב'
                    : reason === 'no_permission'
                    ? 'אין לך הרשאה למחוק ליד זה'
                    : reason === 'not_found'
                    ? 'הליד לא נמצא או כבר נמחק'
                    : res?.msg || 'שגיאה במחיקת הליד'
                alert(msg)
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
