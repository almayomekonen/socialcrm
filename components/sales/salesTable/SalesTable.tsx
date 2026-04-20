'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { notesBtn, saleTableHeaders } from './saleHeaders'
import { deleteDeal, deleteManyDeals, getDealDataToExport, updateDealStatus } from '@/actions/salesTbl'
import { saveTblPref } from '@/actions/global'
import { api } from '@/lib/funcs'
import { redirect } from 'next/navigation'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import TableFooter from '@/lib/table/TableFooter'
import { Select } from '@/lib/form'
import { DEAL_STATUS_OPTIONS, normalizeStatus } from '@/types/lists'
import { ActionsMenu, DotsMenu, getActions, SelectSalesGrpActions } from './funcs'
import GroupAction from './GroupAction'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import UploadClientData from '@/components/settings/UploadClientData'
import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { searchContacts } from '@/actions/clients'
import Table, { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'
import { checkedIds } from '@/lib/table/funcs'

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
    hasLeads?: boolean
  }
}

export default function SalesTable({ props }: SaleTableProps) {
  const { data, params, rawFilter, user, formProps, setCurSale, setOpenForm, curSale, hasLeads } = props
  const safeData = Array.isArray(data) ? data : []
  const { isFav } = params || {}
  const tblId = 'saleTable376'
  useKeepTblScrollPos(tblId)
  const [state, setState] = useState<any[]>(safeData)

  const validHeaders = saleTableHeaders(user)
  const validKeys = new Set(validHeaders.map((h) => h.key))
  const savedPref = user?.tblPref?.[tblId]?.filter((col) => validKeys.has(col.key))
  const [columns, setColumns] = useState(savedPref?.length ? savedPref : validHeaders)
  const [openUpload, setOpenUpload] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [confirmDeleteSale, setConfirmDeleteSale] = useState<any>(null)

  // DOM-sourced selection, mirrored into state so the bulk bar can react.
  // Same contract as SelectSalesGrpActions → checkedIds().
  useEffect(() => {
    const el = document.getElementById(tblId)
    if (!el) return
    const sync = () => setSelectedIds(checkedIds())
    el.addEventListener('change', sync)
    return () => el.removeEventListener('change', sync)
  }, [tblId])

  // Drop ids that are no longer visible (filter/sort/pagination changes).
  useEffect(() => {
    setSelectedIds((prev) => {
      const visibleIds = new Set((Array.isArray(state) ? state : []).map((r: any) => Number(r.id)))
      return prev.filter((id) => visibleIds.has(id))
    })
  }, [state?.length])

  function clearDomChecks() {
    const all = document.getElementById('checkAll') as HTMLInputElement | null
    if (all) all.checked = false
    document
      .querySelectorAll<HTMLInputElement>("[name='checkRow']")
      .forEach((cb) => (cb.checked = false))
    setSelectedIds([])
  }

  function handleBulkDelete() {
    if (!selectedIds.length) return
    setConfirmBulkDelete(true)
  }

  async function performBulkDelete() {
    const ids = selectedIds
    if (!ids.length) {
      setConfirmBulkDelete(false)
      return
    }

    const res = await api(deleteManyDeals, [ids], 'העסקאות נמחקו')
    setConfirmBulkDelete(false)
    if (res?.err) return

    const deleted: number = typeof res?.deleted === 'number' ? res.deleted : 0
    const skipped: number = typeof res?.skipped === 'number' ? res.skipped : 0

    if (deleted > 0) {
      const deletedSet = new Set<number>(
        deleted === ids.length ? ids : ids.slice(0, deleted),
      )
      setState((prev) => prev.filter((r: any) => !deletedSet.has(Number(r.id))))
    }

    clearDomChecks()

    if (skipped > 0) alert(`${skipped} עסקאות לא נמחקו (ללא הרשאה או לא נמצאו)`)
  }

  async function performSaleDelete() {
    const target = confirmDeleteSale
    if (!target?.id) {
      setConfirmDeleteSale(null)
      return
    }
    const res = await api(deleteDeal, target.id, 'העסקה נמחקה בהצלחה')
    setConfirmDeleteSale(null)
    if (res?.err || res?.error) return
    setState((prev) => prev.filter((r: any) => Number(r.id) !== Number(target.id)))
  }

  const emptyState = (state?.length ?? 0) === 0 ? (
    <div className='text-center py-8 flex flex-col items-center gap-4'>
      <p className='text-lg font-semibold'>אין עדיין עסקאות</p>
      <p className='text-sm text-gray-500'>כדי להתחיל, עבור ללידים וסגור עסקה</p>
      <div className='flex gap-3 justify-center items-center'>
        <Btn lbl='מעבר ללידים' href='/leads' />
        {hasLeads && (
          <Btn lbl='הוסף עסקה' icon='plus' variant='ghost' onClick={() => (setOpenForm(true), setCurSale(null))} />
        )}
      </div>
    </div>
  ) : null

  function selectStatus(status, item) {
    return (
      <Select
        key={item.id}
        defaultValue={normalizeStatus(status)}
        onChange={(e) => {
          api(updateDealStatus, [item.id, e.target.value], 'סטטוס עודכן בהצלחה')
          const sale = safeData.find((i) => i.id === item.id)
          if (!sale) return
          sale.status = e.target.value
          if (e.target.value === 'שולם') sale.saleDt = new Date()
          setState([...safeData])
        }}
        options={DEAL_STATUS_OPTIONS}
        val='value'
        show='label'
        className='min-w-28'
      />
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
    funcs: { selectStatus, notesBtn },
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
    emptyState,
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
            <SelectSearch placeholder='חיפוש עסקה' show='details' searchFunc={searchContacts} onSelectOpt={getSelectedClient} />
            <GroupAction isFav={isFav} />
          </div>

          <div className='flex gap-2 items-end mb-2'>
            {selectedIds.length > 0 && (
              <Btn
                variant='destructive'
                icon='trash'
                lbl={
                  selectedIds.length === (state?.length ?? 0)
                    ? `מחק הכל (${selectedIds.length})`
                    : `מחק (${selectedIds.length})`
                }
                onClick={handleBulkDelete}
              />
            )}
            <ShowColumns config={config} />
            <ExportTable dataToFetch={getDealDataToExport} columns={columns} />
            {hasLeads && <Btn lbl='הוסף עסקה' icon='plus' onClick={() => (setOpenForm(true), setCurSale(null))} className='ms-4' />}
          </div>
        </div>

        <Table config={config} tblCls='mb-0' />
        <TableFooter />
      </div>

      <ModalPop open={openUpload} pos='middle' onClose={() => setOpenUpload(false)}>
        <UploadClientData />
      </ModalPop>

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

                    case 'מחיקה':
                      setConfirmDeleteSale(curSale)
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

      <ConfirmPop
        open={confirmBulkDelete}
        destructive
        confirmLbl='מחיקה'
        msg={`למחוק ${selectedIds.length} עסקאות?`}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={performBulkDelete}
      />

      <ConfirmPop
        open={!!confirmDeleteSale}
        destructive
        confirmLbl='מחיקה'
        msg={`בטוח למחוק עסקה של ${confirmDeleteSale?.clientData} ?`}
        onClose={() => setConfirmDeleteSale(null)}
        onConfirm={performSaleDelete}
      />
    </>
  )
}
