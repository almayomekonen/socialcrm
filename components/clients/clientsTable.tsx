'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ExportTable from '@/lib/table/export'
import { leadSourceChannel, leadSourceLabel } from '@/lib/leads/leadSourceLabel'
import { LEAD_OPEN_EDU } from '@/lib/education/types'
import TableFooter from '../../lib/table/TableFooter'
import { ActionsMenu, DEAL_ACTION_LABELS, DotsMenu, getActions, SelectClientGrpActions } from './funcs'
import SelectClientLists from './SelectClientLists'
import { useKeepTblScrollPos } from '@/lib/hooksNEvents'
import ClientFormPop from './ClientFormPop'
import ModalPop from '../../lib/modals/ModalPop'
import ConfirmPop from '../../lib/modals/ConfirmPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'
import UploadClientData from '@/components/settings/UploadClientData'
import { useRouter, useSearchParams } from 'next/navigation'
import TransferClientForm from './TransferClientForm'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { Select } from '@/lib/form'
import { deleteLead, searchContacts, searchLeads } from '@/actions/clients'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { blockReasonText } from '@/lib/leads/deleteResult'
import { ConfigT } from '@/lib/table'
import ShowColumns from '@/lib/table/ShowColumns'
import { saveTblPref } from '@/actions/global'
import LeadStatusCell, { STATUS_STYLES } from './LeadStatusCell'
import LeadsTableView from './LeadsTableView'
import LeadsTableEmptyState from './LeadsTableEmptyState'
import { clearLeadScopeParams, clearLeadSearchParams, hasActiveLeadScope, parseLeadSearch, withLeadSearch } from '@/lib/leads/leadScope'
import { useLeadsState } from './hooks/useLeadsState'
import { useLeadActions } from './hooks/useLeadActions'
import { useLeadSelection } from './hooks/useLeadSelection'
import { openLeadWhatsappInInbox } from '@/modules/inbox/client/openLeadWhatsapp'

export default function ClientsTable({ data, user, leads = false, globalLatestUpdatedAt = '', formProps = null, fillHeight = false, columnAvailability = null }) {
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
  // none of the results — see the effect below.
  const [activeTab, setActiveTab] = useState('new')
  const tblId = leads ? 'leadsTable435' : 'clientsTable435'
  const hasMultipleUsers = false

  const {
    setLiveLeads,
    setDeletedIds,
    setOptimisticStatuses,
    mergedState,
    filteredData: rawFilteredData,
  } = useLeadsState({ data, leads, activeTab, globalLatestUpdatedAt })

  const [sortMode, setSortMode] = useState<'priority' | 'newest'>('priority')
  const filteredData = useMemo(
    () =>
      sortMode === 'newest'
        ? [...rawFilteredData].sort(
            (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
          )
        : rawFilteredData,
    [rawFilteredData, sortMode],
  )

  const { updatingId, highlightedId, statusAnnounce, handleStatusChange } = useLeadActions({
    activeTab,
    setActiveTab,
    setOptimisticStatuses,
  })

  const [deleting, setDeleting] = useState(false)

  const {
    selectedIds,
    handleBulkDelete,
    bulkConfirmOpen,
    closeBulkConfirm,
    performBulkDelete,
    bulkInfoMsg,
    closeBulkInfo,
  } = useLeadSelection({
    leads,
    tblId,
    filteredData,
    activeTab,
    setLiveLeads,
    setDeletedIds,
    setDeleting,
  })

  const validHeaders = getHeaders(leads, hasMultipleUsers)
  const validKeys = new Set(validHeaders.map((h) => h.key))
  const savedPref = user?.tblPref?.[tblId]?.filter((col) => validKeys.has(col.key))
  const savedKeys = new Set(savedPref?.map((c) => c.key) || [])
  const missingFromPref = validHeaders.filter((h) => !savedKeys.has(h.key))
  const initialColumns = savedPref?.length ? [...savedPref, ...missingFromPref] : validHeaders
  const [columns, setColumns] = useState(initialColumns)

  const [curClient, setCurClient] = useState(null)
  const [openForm, setOpenForm] = useState(false)
  const [openTransferClientForm, setOpenTransferClientForm] = useState(false)
  const [openSaleForm, setOpenSaleForm] = useState(false)
  const [openUpload, setOpenUpload] = useState(false)
  const [confirmDeleteLead, setConfirmDeleteLead] = useState(null)
  const [deleteErrMsg, setDeleteErrMsg] = useState<string | null>(null)

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
        leads={leads}
      />
    )
  }

  /**
   * A committed search REPLACES the previous one. `pageNum` goes with it — the
   * offset belonged to a wider result set — and legacy `clientId`/`clientDetails`
   * are swept out of any bookmarked URL on the way past.
   *
   * History: entering a search from an unfiltered workspace is a place worth
   * coming back to, so it pushes. Changing an active search replaces, so five
   * searches in a row do not cost five Back presses. `scroll: false` keeps the
   * rep where they were.
   */
  function commitSearch(term: string) {
    const next = withLeadSearch(new URLSearchParams(searchParams.toString()), term)
    goTo(next, searchTerm ? 'replace' : 'push')
  }

  /** Clearing the box clears the search and nothing else. Always a replace. */
  function clearSearch() {
    if (!searchTerm) return
    goTo(clearLeadSearchParams(new URLSearchParams(searchParams.toString())), 'replace')
  }

  /**
   * The empty state's single way out. Wider than clearing the box: the screen
   * can also be empty because of a saved list or a `?view=due` arrival from the
   * dashboard, and a button that lifted only the search would visibly do nothing
   * there.
   */
  function clearAllScope() {
    goTo(clearLeadScopeParams(new URLSearchParams(searchParams.toString())), 'replace')
  }

  function goTo(params: URLSearchParams, mode: 'push' | 'replace') {
    const next = params.toString()
    const href = (next ? `?${next}` : '?') as any
    if (mode === 'push') router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }

  /**
   * THE TAB FOLLOWS THE RESULTS.
   *
   * The table filters rows by the active status tab, so a rep sitting on "חדש"
   * who searches a lead in "בטיפול" would get an empty table over a result set
   * that does contain their lead. When a new search lands and the current tab
   * holds none of its results, move to the first status that does.
   *
   * Only on a search change, and only when the current tab is empty — browsing
   * and manual tab clicks are never overridden. This is the one piece of the
   * old `clientId` behaviour worth keeping, re-keyed from "a record was picked"
   * to "a search landed".
   */
  /**
   * Seeded ONCE per search, and only once results actually exist — the URL and
   * the rows do not always arrive in the same render. After that the rep owns
   * the tab: clicking one is never overridden, and clearing the search arms the
   * next one.
   */
  const seededForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!leads) return
    if (!searchTerm) {
      seededForRef.current = null
      return
    }
    if (mergedState.length === 0 || seededForRef.current === searchTerm) return
    seededForRef.current = searchTerm
    setActiveTab((current) => {
      if (mergedState.some((l) => l.status === current)) return current
      return Object.keys(STATUS_STYLES).find((k) => mergedState.some((l) => l.status === k)) ?? current
    })
  }, [searchTerm, leads, mergedState])

  const emptyState = (
    <LeadsTableEmptyState
      leads={leads}
      filteredCount={filteredData.length}
      rows={mergedState}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      scoped={scoped}
      scopeKind={searchTerm ? 'search' : 'filter'}
      onClearScope={clearAllScope}
      onAddLead={() => (setOpenForm(true), setCurClient(null))}
      onUploadLeads={() => setOpenUpload(true)}
    />
  )


  const hiddenKeys = useMemo(() => {
    const gated = ['idNum', 'secPhone', 'birthDate', 'gender'] as const
    return new Set<string>(gated.filter((k) => !columnAvailability?.[k]))
  }, [columnAvailability])

  const config = {
    tblId,
    columns,
    hiddenKeys,
    setColumns,
    state: filteredData,
    setState: setLiveLeads,
    moreHeads,
    moreRows,
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
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
    emptyState,
    clsBody: deleting ? 'opacity-50 pointer-events-none' : '',
  } as ConfigT

  /**
   * Picking a suggestion searches for that lead BY NAME — it does not open a
   * private one-record workspace. `firstName lastName` is exactly what the
   * server's `q` matcher tests against `name`/`firstName`/`lastName`.
   *
   * Never `details`: that column is generated as
   * `firstName || ' ' || lastName || ' (' || idNum || ')'`, so committing it
   * would put a national ID in the URL — shareable, loggable — and still match
   * nothing, because `q` does not search `details`.
   */
  function getSelectedClient(client) {
    const name = [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim()
    if (!name) return
    commitSearch(name)
  }

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
          setActiveTab={setActiveTab}
          filteredData={filteredData}
          mergedState={mergedState}
          config={config}
          fillHeight={fillHeight}
          searchTerm={searchTerm}
          onClearSearch={clearSearch}
        >
          <div className={`flex justify-between gap-2 mb-2 items-end ${fillHeight ? 'shrink-0' : ''}`}>
            <div className='flex gap-0 items-end'>
              <SelectSearch
                options={[]}
                show='details'
                selected={null}
                val='id'
                inputCls='w-52 rounded-e-none'
                searchFunc={leads ? searchLeads : searchContacts}
                onSelectOpt={getSelectedClient}
                onSubmitText={commitSearch}
                onClear={clearSearch}
                initShow={searchTerm}
              />
              <Btn variant='outline' size='icon' icon='eraser' aria-label='נקה חיפוש' href='?' scroll={false} className='rounded-s-none border-s-0' />
            </div>

            <div className='flex gap-2 items-end'>
              {selectedIds.length > 0 && (
                <Btn
                  variant='destructive'
                  icon={deleting ? 'spinner' : 'trash'}
                  iconClassName={deleting ? 'animate-spin' : ''}
                  disabled={deleting}
                  lbl={
                    deleting
                      ? `מוחק... (${selectedIds.length})`
                      : leads
                        ? selectedIds.length === filteredData.length
                          ? `מחק הכל (${selectedIds.length})`
                          : `מחק (${selectedIds.length})`
                        : `מחק לקוחות (${selectedIds.length})`
                  }
                  onClick={handleBulkDelete}
                />
              )}
              <Select
                options={[
                  { id: 'priority', name: 'מיון: דחופים ביותר' },
                  { id: 'newest', name: 'מיון: חדשים ביותר' },
                ]}
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as 'priority' | 'newest')}
                required={false}
                aria-label='מיון לידים'
              />
              <ShowColumns config={config} />
              <SelectClientGrpActions user={user} />
              <SelectClientLists />
              <ExportTable data={mergedState} columns={columns} />
              <Btn data-edu={leads ? 'leads-add' : undefined} lbl={leads ? 'ליד חדש' : 'לקוח חדש'} icon='plus' onClick={() => (setOpenForm(true), setCurClient(null))} />
            </div>
          </div>
        </LeadsTableView>
        {fillHeight ? (
          <div className='shrink-0'>
            <TableFooter />
          </div>
        ) : (
          <TableFooter />
        )}
      </div>

      <ModalPop open={openForm} label='פרטי ליד' pos='middle' onClose={() => (setCurClient(null), setOpenForm(false))}>
        <ClientFormPop client={curClient} onClose={() => (setCurClient(null), setOpenForm(false))} />
      </ModalPop>

      <ModalPop open={openTransferClientForm} label='שיוך ליד לנציג' pos='middle' onClose={() => (setCurClient(null), setOpenTransferClientForm(false))}>
        <TransferClientForm client={curClient} />
      </ModalPop>

      <ModalPop open={openUpload} label='העלאת לידים' pos='middle' onClose={() => setOpenUpload(false)}>
        <UploadClientData />
      </ModalPop>

      {formProps && (
        <ModalPop open={openSaleForm} label='טופס עסקה' onClose={() => (setCurClient(null), setOpenSaleForm(false))}>
          <SaleForm
            props={formProps}
            curSale={curClient ? ({ clientId: curClient.id, clientData: curClient.name } as any) : undefined}
            onClose={() => (setCurClient(null), setOpenSaleForm(false))}
          />
        </ModalPop>
      )}

      <ActionsMenu id='clientActions'>
        {curClient && (
          <div>
            <Btn
              variant='simple'
              size='simple'
              lbl='פתח ליד'
              onClick={() => router.push(`/clients/${curClient.id}/summary`)}
            />
          </div>
        )}
        {curClient?.phone && (
          <>
            <div>
              <div className='h-px bg-gray-200 w-full' />
              <Btn variant='simple' size='simple' lbl='התקשר' onClick={() => window.location.href = `tel:${curClient.phone}`} />
            </div>
            <div>
              <div className='h-px bg-gray-200 w-full' />
              <Btn
                variant='simple'
                size='simple'
                lbl='WhatsApp'
                onClick={() => openLeadWhatsappInInbox(curClient.id, router.push)}
              />
            </div>
          </>
        )}
        {Object.entries(getActions(curClient?.status))
          .filter(([lbl]) => hasMultipleUsers || lbl !== 'העברה לבעל ליד אחר')
          .map(([lbl, action]) => (
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
                      case 'העברה לבעל ליד אחר':
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
            onClick={() => setConfirmDeleteLead(curClient)}
          />
        </div>
      </ActionsMenu>

      <ConfirmPop
        open={bulkConfirmOpen}
        destructive
        confirmLbl='מחיקה'
        msg={`למחוק ${selectedIds.length} ${leads ? 'לידים' : 'לקוחות'}?`}
        onClose={closeBulkConfirm}
        onConfirm={performBulkDelete}
      />

      <ConfirmPop
        open={!!confirmDeleteLead}
        destructive
        confirmLbl='מחיקה'
        msg={`האם למחוק ליד ${confirmDeleteLead?.name}?`}
        onClose={() => setConfirmDeleteLead(null)}
        onConfirm={async () => {
          const target = confirmDeleteLead
          if (!target) return
          const res = await api(deleteLead, target.id, undefined, undefined, { silentSuccess: true })
          if (res?.err || res?.error) {
            const reason = res?.reason
            const msg =
              reason === 'no_permission'
                ? 'אין לך הרשאה למחוק ליד זה'
                : reason === 'not_found'
                ? 'הליד לא נמצא או כבר נמחק'
                : reason === 'has_billing'
                ? `לא ניתן למחוק — ${res?.block ? blockReasonText(res.block) : 'הליד מקושר למערכת החיובים'}`
                : res?.msg || 'שגיאה במחיקת הליד'
            setDeleteErrMsg(msg)
            setConfirmDeleteLead(null)
            return
          }
          toast('success', 'הליד נמחק')
          setLiveLeads((prev) => prev.filter((c) => c.id !== target.id))
          setDeletedIds((prev) => new Set([...prev, target.id]))
          setConfirmDeleteLead(null)
        }}
      />

      <ConfirmPop
        open={!!deleteErrMsg}
        hideCancel
        onClose={() => setDeleteErrMsg(null)}
        onConfirm={() => setDeleteErrMsg(null)}
        msg={deleteErrMsg ?? ''}
      />

      <ConfirmPop
        open={!!bulkInfoMsg}
        hideCancel
        onClose={closeBulkInfo}
        onConfirm={closeBulkInfo}
        msg={bulkInfoMsg ?? ''}
      />
    </>
  )
}

export function getHeaders(leads, hasMultipleUsers = true) {
  const headers = [
    { key: 'name', label: 'שם מלא', format: 'formatName' },
    { key: 'phone', label: 'מספר טלפון' },
    { key: 'status', label: 'סטטוס', format: 'formatStatus' },
    { key: 'nextAction', label: 'פעולה הבאה', format: 'formatNextAction' },
    { key: 'leadSource', label: 'מקור', format: 'formatLeadSource' },
    ...(hasMultipleUsers
      ? [
          { key: 'userName', label: 'בעל הליד' },
          { key: 'handlerName', label: 'אחראי נוסף (לא חובה)' },
        ]
      : []),
    { key: 'email', label: 'מייל' },
    // Optional, opt-in columns — hidden by default (noShow), available via the Columns selector.
    { key: 'idNum', label: 'תעודת זהות', noShow: true },
    { key: 'secPhone', label: 'טלפון נוסף', noShow: true },
    { key: 'birthDate', label: 'תאריך לידה', format: 'formatDate', noShow: true },
    { key: 'gender', label: 'מין', noShow: true },
  ]
  if (leads) {
    headers.push(
      { key: 'leadStatus', label: 'מצב ליד', format: 'formatLeadStatus' },
    )
  }
  headers.push({ key: 'lastContact', label: 'מגע אחרון', format: 'formatLastContact' })
  return headers
}

const SOURCE_STYLES: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  whatsapp: 'bg-green-100 text-green-700',
  instagram: 'bg-pink-100 text-pink-700',
  // Violet, not indigo/teal: at this tint indigo reads as Facebook's blue and
  // teal as WhatsApp's green. Carries no status meaning of its own.
  website: 'bg-violet-100 text-violet-700',
  manual: 'bg-gray-100 text-gray-600',
}

function formatLeadSource(source) {
  // Normalize the stored (possibly composite `channel:externalId`) value to a
  // clean user-facing label + a canonical style key. The raw composite is never
  // rendered, and a WhatsApp/Facebook webhook lead now styles like its channel
  // instead of falling into the gray unknown bucket.
  const channel = leadSourceChannel(source)
  const cls = (channel && SOURCE_STYLES[channel]) || 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {leadSourceLabel(source)}
    </span>
  )
}


function formatName(name, obj, forLeads = false) {
  return (
    <span className='inline-flex items-center gap-2'>
      <Link href={`/clients/${obj.id}/summary`} className='underline font-semibold' data-edu={forLeads ? LEAD_OPEN_EDU : undefined}>
        {name}
      </Link>
      {obj.lead === false && (
        <span className='text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium whitespace-nowrap'>
          לקוח
        </span>
      )}
    </span>
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

function formatLastContact(_: unknown, obj: Record<string, unknown>) {
  const raw = (obj.updatedAt as string | null) || (obj.createdAt as string | null)
  if (!raw) return null
  const days = Math.floor((Date.now() - new Date(raw).getTime()) / 86400000)
  const label = days <= 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`
  const isStale = days > 14
  return <span className={isStale ? 'text-xs font-medium text-amber-600' : 'text-xs font-medium text-gray-700'}>{label}</span>
}
