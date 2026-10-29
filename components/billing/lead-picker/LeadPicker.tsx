'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '@/lib/Icon'
import { useCanTopLayer } from '@/lib/useTopLayer'
import { searchLeads } from '@/actions/clients'
import LeadPickerPanel from './LeadPickerPanel'
import type { RecentLead } from './types'
import { useT } from '@/lib/i18n/I18nProvider'

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
 *
 * LANGUAGE: follows the interface language (`useT`; Hebrew outside a
 * provider). Every caller is a translated screen — the invoice editor, the
 * new-meeting dialog (Phase E1), Messenger's lead actions (Phase D) — so no
 * opt-in prop. The portalled panel re-declares the language itself.
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
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RecentLead[]>(() => [...recentLeads])
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const canTopLayer = useCanTopLayer()

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
        <span className='truncate'>{currentLeadName || t('billing.picker.trigger')}</span>
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
            canTopLayer={canTopLayer}
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
