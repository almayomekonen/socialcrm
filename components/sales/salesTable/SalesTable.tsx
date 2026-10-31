'use client'

import { useEffect, useMemo, useState } from 'react'
import { dealColumnLabel, notesBtn, saleTableHeaders } from './saleHeaders'
import { deleteDeal, deleteManyDeals, updateDealStatus } from '@/actions/salesTbl'
import { saveTblPref } from '@/actions/global'
import { api } from '@/lib/funcs'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import TableFooter from '@/lib/table/TableFooter'
import { Select } from '@/lib/form'
import { normalizeStatus, dealStatusStyle } from '@/types/lists'
import { dealActionLabel, dealCompanyLabel, dealLeadSourceLabel, dealProductLabel, dealStatusOptions } from '@/lib/deals/labels'
import { useT } from '@/lib/i18n/I18nProvider'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { DotsMenu } from './funcs'
import SalesTableDialogs from './SalesTableDialogs'
import SalesEmptyState from './SalesEmptyState'
import SalesTableToolbar from './SalesTableToolbar'
import Table, { ConfigT } from '@/lib/table'
import { actionsColumnEdge, checkedIds } from '@/lib/table/funcs'

/** Columns showing a STORED Hebrew value → the display-only formatter used outside Hebrew. */
const STORED_VALUE_FORMAT: Record<string, string> = { company: 'dealCompany', prdct: 'dealProduct', action: 'dealAction', leadSource: 'dealSource' }

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
    fillHeight?: boolean
  }
}

export default function SalesTable({ props }: SaleTableProps) {
  const { data, params, rawFilter, user, formProps, setCurSale, setOpenForm, curSale, hasLeads, fillHeight } = props
  const t = useT()
  const locale = t.locale
  const safeData = Array.isArray(data) ? data : []
  const { isFav } = params || {}
  const tblId = 'saleTable376'
  useKeepTblScrollPos(tblId)
  const [state, setState] = useState<any[]>(safeData)

  const validHeaders = saleTableHeaders(user)
  const validKeys = new Set(validHeaders.map((h) => h.key))
  const savedPref = user?.tblPref?.[tblId]?.filter((col) => validKeys.has(col.key))
  const [columns, setColumns] = useState(savedPref?.length ? savedPref : validHeaders)
  // Headers by column KEY in the interface language; the stored columns (and the export) keep their Hebrew labels.
  const localized = useLocalizedColumns(columns, setColumns, (next) => saveTblPref(tblId, next), dealColumnLabel)
  const statusOptions = useMemo(() => dealStatusOptions(locale), [locale])
  // Outside Hebrew, stored values in these columns are labelled for display (Hebrew shows the stored value, as before).
  const displayColumns = useMemo(
    () => (locale === 'he' ? localized.columns : localized.columns.map((c) => (STORED_VALUE_FORMAT[c.key] && !c.format ? { ...c, format: STORED_VALUE_FORMAT[c.key] } : c))),
    [localized.columns, locale],
  )
  const [openUpload, setOpenUpload] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [confirmDeleteSale, setConfirmDeleteSale] = useState<any>(null)
  const [bulkInfoMsg, setBulkInfoMsg] = useState<string | null>(null)

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

    const res = await api(deleteManyDeals, [ids], t('deals.table.toast.bulkDeleted'))
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

    // Counts as their digits (no grouping), exactly as Hebrew printed them.
    if (skipped > 0) setBulkInfoMsg(t('deals.table.skipped', { count: String(skipped) }))
  }

  async function performSaleDelete() {
    const target = confirmDeleteSale
    if (!target?.id) {
      setConfirmDeleteSale(null)
      return
    }
    const res = await api(deleteDeal, target.id, t('deals.table.toast.deleted'))
    setConfirmDeleteSale(null)
    if (res?.err || res?.error) return
    setState((prev) => prev.filter((r: any) => Number(r.id) !== Number(target.id)))
  }

  const emptyState =
    (state?.length ?? 0) === 0 ? <SalesEmptyState hasLeads={hasLeads} onAdd={() => (setOpenForm(true), setCurSale(null))} /> : null

  function selectStatus(status, item) {
    const s = dealStatusStyle(status)
    return (
      <Select
        key={item.id}
        defaultValue={normalizeStatus(status)}
        onChange={(e) => {
          api(updateDealStatus, [item.id, e.target.value], t('deals.table.toast.statusUpdated'))
          const sale = safeData.find((i) => i.id === item.id)
          if (!sale) return
          sale.status = e.target.value
          if (e.target.value === 'שולם') sale.saleDt = new Date()
          setState([...safeData])
        }}
        options={statusOptions}
        val='value'
        show='label'
        className={`min-w-28 ${s.bg} ${s.text} ${s.border}`}
      />
    )
  }

  function moreRows(sale) {
    return (
      <>
        <td className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-white`}>
          <DotsMenu id='saleActions' onClick={() => setCurSale(sale)} />
        </td>
      </>
    )
  }

  function moreHeads() {
    return <th className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-gray-100`}>{t('deals.table.actions')}</th>
  }

  const config = {
    tblId,
    columns: displayColumns,
    setColumns: localized.setColumns,
    data,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: {
      selectStatus,
      notesBtn,
      // Outside Hebrew, dates in the interface language (Hebrew keeps the shared legacy formatter).
      ...(locale === 'he'
        ? {}
        : {
            formatDate: (value) => (value ? formatLeadDate(locale, value) : ''),
            dealCompany: (value) => dealCompanyLabel(value, locale),
            dealProduct: (value) => dealProductLabel(value, locale),
            dealAction: (value) => dealActionLabel(value, locale),
            dealSource: (value) => dealLeadSourceLabel(value, locale),
          }),
    },
    getColumns(columns) {
      localized.save(columns as unknown as Parameters<typeof localized.save>[0])
    },
    emptyState,
  } as ConfigT

  return (
    <>
      <div className={`flex flex-col items-stretch gap-0 ${fillHeight ? 'min-h-0 flex-1' : ''}`}>
        <SalesTableToolbar
          fillHeight={fillHeight}
          isFav={isFav}
          selectedCount={selectedIds.length}
          rowCount={state?.length ?? 0}
          onBulkDelete={handleBulkDelete}
          config={config}
          columns={columns}
          onImport={() => setOpenUpload(true)}
          onAdd={hasLeads ? () => (setOpenForm(true), setCurSale(null)) : undefined}
        />

        <Table config={config} tblCls={fillHeight ? 'mb-0 !rounded-b-none tbl-fill' : 'mb-0 !max-h-[32rem] !rounded-b-none'} />
        {fillHeight ? (
          <div className='shrink-0'>
            <TableFooter />
          </div>
        ) : (
          <TableFooter />
        )}
      </div>

      <SalesTableDialogs
        openUpload={openUpload}
        setOpenUpload={setOpenUpload}
        curSale={curSale}
        isFav={isFav}
        setOpenForm={setOpenForm}
        confirmBulkDelete={confirmBulkDelete}
        setConfirmBulkDelete={setConfirmBulkDelete}
        selectedIds={selectedIds}
        performBulkDelete={performBulkDelete}
        confirmDeleteSale={confirmDeleteSale}
        setConfirmDeleteSale={setConfirmDeleteSale}
        performSaleDelete={performSaleDelete}
        bulkInfoMsg={bulkInfoMsg}
        setBulkInfoMsg={setBulkInfoMsg}
      />
    </>
  )
}
