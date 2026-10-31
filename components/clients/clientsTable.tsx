'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ExportTable from '@/lib/table/export'
import { LEAD_OPEN_EDU } from '@/lib/education/types'
import TableFooter from '../../lib/table/TableFooter'
import { DotsMenu } from './funcs'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConfigT } from '@/lib/table'
import { saveTblPref } from '@/actions/global'
import LeadStatusCell from './LeadStatusCell'
import LeadsTableView from './LeadsTableView'
import LeadsTableEmptyState from './LeadsTableEmptyState'
import { hasActiveLeadScope, parseLeadSearch } from '@/lib/leads/leadScope'
import { useLeadsState } from './hooks/useLeadsState'
import { useLeadActions } from './hooks/useLeadActions'
import { useLeadSelection } from './hooks/useLeadSelection'
import { useOpenDialogFromQuery } from './hooks/useOpenDialogFromQuery'
import { getHeaders, initialColumns } from './table/headers'
import { CustomerBadge, formatLastContact, formatLeadSource, formatLeadStatus, formatNextAction, formatState } from './table/cells'
import { useLocalizedColumns } from './table/useLocalizedColumns'
import { useT } from '@/lib/i18n/I18nProvider'
import { actionsColumnEdge } from '@/lib/table/funcs'
import { useLeadSearch, useSearchTabFollow } from './table/useLeadSearch'
import { useLeadDelete } from './table/useLeadDelete'
import LeadsToolbar, { type SortMode } from './table/LeadsToolbar'
import LeadRowActionsMenu from './table/LeadRowActionsMenu'
import { LeadsTableConfirms, LeadsTableDialogs } from './table/LeadsTableDialogs'
import { useLeadDialogs } from './table/useLeadDialogs'

export { getHeaders } from './table/headers'

/**
 * The /leads and /clients table — a thin orchestrator. Search, toolbar, row
 * menu, dialogs, cell formatters and column definitions live in `./table/`.
 */
export default function ClientsTable({ data, user, leads = false, globalLatestUpdatedAt = '', formProps = null, fillHeight = false, columnAvailability = null, whatsappConnected = undefined }) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchTerm = parseLeadSearch({ q: searchParams.get('q') })

  /**
   * URL SCOPE. `?q=` is the workspace search — the SAME filter the mobile list
   * uses, applied server-side. It narrows the workspace; it does not replace it
   * with one record, which is what `?clientId=` used to do and why a search
   * could read as "all my leads are gone".
   *
   * `scoped` tells the empty state which story it is in; see LeadsTableEmptyState.
   * The component is deliberately NOT keyed on the search: re-keying would
   * remount on every keystroke-committed search and throw away the rep's sort,
   * column layout and selection.
   */
  const scoped = hasActiveLeadScope({
    q: searchTerm,
    listId: searchParams.get('listId'),
    view: searchParams.get('view'),
  })
  // Plain default. A landing search moves it only when the current tab holds
  // none of the results — see useSearchTabFollow.
  const [activeTab, setActiveTab] = useState('new')
  const tblId = leads ? 'leadsTable435' : 'clientsTable435'
  const hasMultipleUsers = false

  const { setLiveLeads, setDeletedIds, setOptimisticStatuses, mergedState, filteredData: rawFilteredData } =
    useLeadsState({ data, leads, activeTab, globalLatestUpdatedAt })

  const [sortMode, setSortMode] = useState<SortMode>('priority')
  const filteredData = useMemo(
    () =>
      sortMode === 'newest'
        ? [...rawFilteredData].sort(
            (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
          )
        : rawFilteredData,
    [rawFilteredData, sortMode],
  )

  const { updatingId, highlightedId, statusAnnounce, handleStatusChange } = useLeadActions({ activeTab, setActiveTab, setOptimisticStatuses })

  const [deleting, setDeleting] = useState(false)
  const selection = useLeadSelection({ leads, tblId, filteredData, activeTab, setLiveLeads, setDeletedIds, setDeleting })
  const { selectedIds } = selection

  const [columns, setColumns] = useState(() => initialColumns(user, tblId, getHeaders(leads, hasMultipleUsers)))
  const shown = useLocalizedColumns(columns, setColumns, (next) => saveTblPref(tblId, next)) // stored shape stays `columns`

  const dialogs = useLeadDialogs()
  const { curClient, setCurClient, show, openAddForm } = dialogs
  const del = useLeadDelete({ setLiveLeads, setDeletedIds })

  useKeepTblScrollPos(tblId)
  useOpenDialogFromQuery({ enabled: leads, openAdd: openAddForm, openImport: () => show('upload') })

  const search = useLeadSearch({ router, searchParams, searchTerm })
  const selectTab = useSearchTabFollow({ leads, searchTerm, mergedState, setActiveTab })

  function formatStatus(status, obj) {
    return <LeadStatusCell status={status} obj={obj} updatingId={updatingId} onStatusChange={handleStatusChange} leads={leads} />
  }

  const emptyState = (
    <LeadsTableEmptyState
      leads={leads}
      filteredCount={filteredData.length}
      rows={mergedState}
      activeTab={activeTab}
      setActiveTab={selectTab}
      scoped={scoped}
      scopeKind={searchTerm ? 'search' : 'filter'}
      onClearScope={search.clearAllScope}
      onAddLead={openAddForm}
      onUploadLeads={() => show('upload')}
    />
  )

  const hiddenKeys = useMemo(() => {
    const gated = ['idNum', 'secPhone', 'birthDate', 'gender'] as const
    return new Set<string>(gated.filter((k) => !columnAvailability?.[k]))
  }, [columnAvailability])

  const config = {
    tblId,
    columns: shown.columns,
    hiddenKeys,
    setColumns: shown.setColumns,
    state: filteredData,
    setState: setLiveLeads,
    moreHeads: () => <th className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-gray-100 text-center`}>{t('leads.table.actions')}</th>,
    moreRows: (client) => (
      <td className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-white`}>
        <DotsMenu id='clientActions' onClick={() => setCurClient(client)} />
      </td>
    ),
    funcs: {
      formatName: (name, obj) => formatName(name, obj, leads),
      formatStatus,
      formatLeadSource,
      formatLeadStatus,
      formatState,
      formatNextAction,
      formatLastContact,
    },
    addTrCls: (item) => item.id === highlightedId ? 'bg-green-50 transition-all duration-500' : '',
    getColumns: (next) => shown.save(next as any),
    emptyState,
    clsBody: deleting ? 'opacity-50 pointer-events-none' : '',
  } as ConfigT

  return (
    <>
      <div
        className='sr-only'
        role='status'
        aria-live='polite'
        aria-atomic='true'
        data-testid='lead-status-announce'
      >
        {statusAnnounce}
      </div>
      <div className={fillHeight ? 'flex flex-col min-h-0 flex-1' : 'grid'} data-edu={leads ? 'leads-table' : undefined}>
        <LeadsTableView
          leads={leads}
          activeTab={activeTab}
          setActiveTab={selectTab}
          filteredData={filteredData}
          mergedState={mergedState}
          config={config}
          fillHeight={fillHeight}
        >
          <LeadsToolbar
            leads={leads}
            user={user}
            fillHeight={fillHeight}
            config={config}
            search={search}
            searchTerm={searchTerm}
            resultCount={mergedState.length}
            selectedCount={selectedIds.length}
            visibleCount={filteredData.length}
            assigning={selection.assigning}
            deleting={deleting}
            onBulkAssign={selection.handleBulkAssign}
            onBulkDelete={selection.handleBulkDelete}
            sortMode={sortMode}
            onSortChange={setSortMode}
            exportControl={<ExportTable data={mergedState} columns={columns} />}
            onAdd={openAddForm}
          />
        </LeadsTableView>
        {fillHeight ? (
          <div className='shrink-0'>
            <TableFooter />
          </div>
        ) : (
          <TableFooter />
        )}
      </div>

      <LeadsTableDialogs
        open={dialogs.open}
        close={dialogs.close}
        curClient={curClient}
        formProps={formProps}
        selectedCount={selectedIds.length}
        assignOpen={selection.assignOpen}
        closeAssign={selection.closeAssign}
        performBulkAssign={selection.performBulkAssign}
      />

      <LeadRowActionsMenu
        id='clientActions'
        client={curClient}
        hasMultipleUsers={hasMultipleUsers}
        whatsappConnected={whatsappConnected}
        onAction={dialogs.openForAction}
        onDelete={() => del.requestDelete(curClient)}
      />

      <LeadsTableConfirms
        leads={leads}
        selectedCount={selectedIds.length}
        bulkConfirmOpen={selection.bulkConfirmOpen}
        closeBulkConfirm={selection.closeBulkConfirm}
        performBulkDelete={selection.performBulkDelete}
        bulkInfoMsg={selection.bulkInfoMsg}
        closeBulkInfo={selection.closeBulkInfo}
        confirmDeleteLead={del.confirmDeleteLead}
        cancelDelete={del.cancelDelete}
        performDelete={del.performDelete}
        deleteErrMsg={del.deleteErrMsg}
        clearDeleteErr={del.clearDeleteErr}
      />
    </>
  )
}

function formatName(name, obj, forLeads = false) {
  return (
    <span className='inline-flex items-center gap-2'>
      <Link href={`/clients/${obj.id}/summary`} className='underline font-semibold' data-edu={forLeads ? LEAD_OPEN_EDU : undefined}>
        {name}
      </Link>
      {obj.lead === false && <CustomerBadge />}
    </span>
  )
}
