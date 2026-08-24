'use client'

import { Btn } from '@/lib/btns/Btn'
import { STATUS_STYLES } from './LeadStatusCell'

/**
 * What the lead / client table says when it has no rows to draw.
 *
 * Extracted from `clientsTable` (already past the hard file limit) so the three
 * cases can be told apart at a glance, because conflating two of them is the
 * defect this component exists to close:
 *
 *   1. SCOPED EMPTY   — the URL narrows the list (a picked lead, a saved list, a
 *                       view) and nothing matched. There ARE לידים; this query
 *                       found none of them.
 *   2. WORKSPACE EMPTY— nothing is narrowing the list and the table is genuinely
 *                       empty. The only case that may show first-run guidance.
 *   3. TAB EMPTY      — rows exist, the selected status tab holds none of them.
 *
 * Case 1 used to render case 2's copy: a rep who searched a lead while on page 2
 * was told "אין עדיין לידים" — a false statement about their own business, and
 * the first thing `care-charter.md` Law 1 forbids. Filtered-empty is not
 * system-empty (`ux-guidelines.md` §11).
 *
 * Presentation only: every branch reuses the container, `Btn` and copy patterns
 * that were already here. No new UI vocabulary.
 */
export type LeadsTableEmptyStateProps = {
  leads: boolean
  /** Rows the table would draw under the active tab. */
  filteredCount: number
  /** Rows the server returned for this query, before the tab filter. */
  rows: { status?: string | null }[]
  activeTab: string
  setActiveTab: (status: string) => void
  /** True when the URL narrows the list — a picked lead, a saved list, a view. */
  scoped: boolean
  /** Which narrowing it is, so the way out is labelled for what it actually does. */
  scopeKind?: 'search' | 'filter'
  /** Lifts every narrowing and returns to the full list. */
  onClearScope: () => void
  onAddLead: () => void
  onUploadLeads: () => void
}

export default function LeadsTableEmptyState({
  leads,
  filteredCount,
  rows,
  activeTab,
  setActiveTab,
  scoped,
  scopeKind = 'search',
  onClearScope,
  onAddLead,
  onUploadLeads,
}: LeadsTableEmptyStateProps) {
  if (filteredCount > 0) return null

  return (
    <div className='text-center py-8 flex flex-col items-center gap-4'>
      {rows.length === 0 ? (
        scoped ? (
          <ScopedEmpty leads={leads} scopeKind={scopeKind} onClearScope={onClearScope} />
        ) : (
          <WorkspaceEmpty leads={leads} onAddLead={onAddLead} onUploadLeads={onUploadLeads} />
        )
      ) : (
        <TabEmpty
          rows={rows}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onAddLead={onAddLead}
          onUploadLeads={onUploadLeads}
        />
      )}
    </div>
  )
}

/**
 * The list is narrowed and matched nothing.
 *
 * Says what happened, why the screen is empty, and gives one obvious way out —
 * never that the workspace is empty, which it demonstrably is not.
 */
function ScopedEmpty({
  leads,
  scopeKind,
  onClearScope,
}: {
  leads: boolean
  scopeKind: 'search' | 'filter'
  onClearScope: () => void
}) {
  const noun = leads ? 'הלידים' : 'הלקוחות'
  return (
    <>
      <p className='text-lg font-semibold'>{leads ? 'לא נמצאו לידים מתאימים' : 'לא נמצאו לקוחות מתאימים'}</p>
      <p className='text-sm text-gray-500'>
        {scopeKind === 'search'
          ? `החיפוש הנוכחי מצמצם את הרשימה. ${noun} שלך במערכת ולא אבדו.`
          : `הסינון הנוכחי מצמצם את הרשימה. ${noun} שלך במערכת ולא אבדו.`}
      </p>
      <div className='flex gap-3 justify-center'>
        <Btn
          lbl={scopeKind === 'search' ? 'נקה חיפוש' : leads ? 'הצג את כל הלידים' : 'הצג את כל הלקוחות'}
          icon='eraser'
          onClick={onClearScope}
        />
      </div>
    </>
  )
}

/** Nothing is narrowing the list and there is genuinely nothing to show. */
function WorkspaceEmpty({
  leads,
  onAddLead,
  onUploadLeads,
}: {
  leads: boolean
  onAddLead: () => void
  onUploadLeads: () => void
}) {
  return (
    <>
      <p className='text-lg font-semibold'>{leads ? 'אין עדיין לידים' : 'אין לקוחות עדיין'}</p>
      <p className='text-sm text-gray-500'>
        {leads ? 'חבר פייסבוק או הוסף ליד ידנית' : 'אפשר להתחיל על ידי יצירת ליד או העלאת קובץ'}
      </p>
      <div className='flex gap-3 justify-center'>
        <Btn lbl='הוסף ליד' icon='plus' onClick={onAddLead} />
        <Btn lbl='העלה לידים' variant='soft' onClick={onUploadLeads} />
      </div>
    </>
  )
}

/** Rows exist; this status tab holds none of them. Unchanged behaviour. */
function TabEmpty({
  rows,
  activeTab,
  setActiveTab,
  onAddLead,
  onUploadLeads,
}: {
  rows: { status?: string | null }[]
  activeTab: string
  setActiveTab: (status: string) => void
  onAddLead: () => void
  onUploadLeads: () => void
}) {
  const countByStatus = Object.keys(STATUS_STYLES).reduce(
    (acc, key) => ({ ...acc, [key]: rows.filter((l) => l.status === key).length }),
    {} as Record<string, number>,
  )
  // Non-actionable statuses (סגור / אבוד) — excluded from primary suggestion.
  const NON_ACTIONABLE = new Set(['closed', 'lost'])
  const actionableTop = Object.keys(STATUS_STYLES)
    .filter((k) => k !== activeTab && !NON_ACTIONABLE.has(k) && countByStatus[k] > 0)
    .sort((a, b) => countByStatus[b] - countByStatus[a])[0]
  // Fallback: first status with leads (even if non-actionable).
  const fallbackWithLeads = Object.keys(STATUS_STYLES).find((k) => k !== activeTab && countByStatus[k] > 0)
  const topStatus = actionableTop ?? fallbackWithLeads
  const firstWithLeads = Object.keys(STATUS_STYLES).find((k) => countByStatus[k] > 0) ?? topStatus

  return (
    <>
      <p className='text-sm text-gray-500'>אין לידים בסטטוס זה כרגע</p>
      {topStatus && (
        <div className='flex gap-3 justify-center'>
          <Btn
            lbl={`הצג לידים ב"${STATUS_STYLES[topStatus].label}" (${countByStatus[topStatus]})`}
            onClick={() => setActiveTab(topStatus)}
          />
          <Btn variant='outline' lbl='הצג את כל הלידים' onClick={() => firstWithLeads && setActiveTab(firstWithLeads)} />
        </div>
      )}
      <p className='text-sm text-gray-600'>
        <button type='button' className='underline hover:text-gray-800' onClick={onAddLead}>
          הוסף ליד ידנית
        </button>
        {' או '}
        <button type='button' className='underline hover:text-gray-800' onClick={onUploadLeads}>
          העלה קובץ לידים
        </button>
      </p>
    </>
  )
}
