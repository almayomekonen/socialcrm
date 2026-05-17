'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '@/lib/Icon'
import { searchLeads } from '@/actions/clients'
import LeadPickerRow, { dropdownGroupHeaderCls } from './LeadPickerRow'
import type { RecentLead } from './types'

/**
 * Combobox-style customer picker.
 *
 * Trigger button + portal-rendered dropdown panel anchored to the
 * trigger's bounding rect. Two render modes:
 *   - empty query: groups by "already billed" / "other recent leads"
 *   - typed query (2+ chars): flat list from live searchLeads()
 *
 * Closes on outside click. Re-measures position on scroll/resize so
 * the panel tracks the trigger if the page moves while open.
 *
 * Pure picker — does NOT know about invoice creation. The parent
 * decides what to do with the picked lead via `onPick`.
 */
export default function LeadPicker({
  currentLeadId,
  currentLeadName,
  recentLeads,
  onPick,
  onCreateNew,
}: {
  currentLeadId: number
  currentLeadName: string
  recentLeads: ReadonlyArray<RecentLead>
  onPick: (leadId: number) => void
  onCreateNew: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RecentLead[]>(() => [...recentLeads])
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // Track trigger position so the portal-rendered panel anchors under it.
  useEffect(() => {
    if (!isOpen) return
    function measure() {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right, width: rect.width })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [isOpen])

  // Outside-click closes the panel.
  useEffect(() => {
    if (!isOpen) return
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [isOpen])

  // Reset query when the panel closes.
  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  // Live search (debounced). Empty query → recents. 2+ chars → server lookup.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([...recentLeads])
      return
    }
    if (trimmed.length < 2) return
    let cancelled = false
    const handle = setTimeout(async () => {
      const res = await searchLeads(trimmed)
      if (!cancelled) setResults(res as RecentLead[])
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, recentLeads])

  function handlePickLead(leadId: number) {
    setIsOpen(false)
    if (leadId !== currentLeadId) onPick(leadId)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        onClick={() => setIsOpen((v) => !v)}
        className='w-full h-10 px-3 rounded-md bg-white border border-gray-300 hover:border-gray-400 flex items-center justify-between gap-3 text-base text-gray-900 transition-colors'
      >
        <span className='truncate'>{currentLeadName || 'בחר לקוח/ה'}</span>
        <Icon
          name='chevron-down'
          type='reg'
          className={`size-4 bg-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen &&
        mounted &&
        pos &&
        createPortal(
          <LeadPickerPanel
            panelRef={panelRef}
            pos={pos}
            query={query}
            setQuery={setQuery}
            results={results}
            currentLeadId={currentLeadId}
            onPickLead={handlePickLead}
            onCreateNew={() => {
              setIsOpen(false)
              onCreateNew()
            }}
          />,
          document.body,
        )}
    </>
  )
}

/**
 * The portal-rendered dropdown body. Pulled out so LeadPicker stays
 * focused on state + positioning, and the panel JSX stays glanceable.
 */
function LeadPickerPanel({
  panelRef,
  pos,
  query,
  setQuery,
  results,
  currentLeadId,
  onPickLead,
  onCreateNew,
}: {
  panelRef: React.RefObject<HTMLDivElement>
  pos: { top: number; right: number; width: number }
  query: string
  setQuery: (q: string) => void
  results: ReadonlyArray<RecentLead>
  currentLeadId: number
  onPickLead: (id: number) => void
  onCreateNew: () => void
}) {
  const billed = results.filter((l) => (l.invoiceCount ?? 0) > 0)
  const unbilled = results.filter((l) => !(l.invoiceCount ?? 0))
  const showGroups = query.trim().length === 0 && billed.length > 0 && unbilled.length > 0

  return (
    <div
      ref={panelRef}
      style={{ top: pos.top, right: pos.right, width: pos.width }}
      className='fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'
    >
      <input
        type='text'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder='חיפוש לקוח/ה...'
        autoFocus
        className='w-full h-10 px-3 border-b border-gray-100 bg-gray-50 focus:bg-white focus:outline-none text-base placeholder:text-gray-400'
      />
      <div className='max-h-72 overflow-y-auto'>
        {results.length === 0 ? (
          <p className='px-3 py-6 text-sm text-gray-500 text-center'>אין תוצאות</p>
        ) : !showGroups ? (
          results.map((lead) => (
            <LeadPickerRow
              key={lead.id}
              lead={lead}
              isCurrent={lead.id === currentLeadId}
              onClick={() => onPickLead(lead.id)}
            />
          ))
        ) : (
          <>
            <div className={dropdownGroupHeaderCls}>כבר חויבו</div>
            {billed.map((lead) => (
              <LeadPickerRow
                key={lead.id}
                lead={lead}
                isCurrent={lead.id === currentLeadId}
                onClick={() => onPickLead(lead.id)}
              />
            ))}
            <div className={dropdownGroupHeaderCls}>לידים אחרונים</div>
            {unbilled.map((lead) => (
              <LeadPickerRow
                key={lead.id}
                lead={lead}
                isCurrent={lead.id === currentLeadId}
                onClick={() => onPickLead(lead.id)}
              />
            ))}
          </>
        )}
      </div>
      <button
        type='button'
        onClick={onCreateNew}
        className='border-t border-gray-200 px-3 py-3 hover:bg-gray-50 text-sm font-medium text-solid flex items-center gap-1.5 bg-white shrink-0 w-full'
      >
        <span aria-hidden>+</span>
        <span>יצירת לקוח/ה חדש/ה</span>
      </button>
    </div>
  )
}
