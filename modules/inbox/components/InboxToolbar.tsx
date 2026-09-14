'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import InboxChannelSwitch from './InboxChannelSwitch'
import { inboxFiltersToSearchParams } from '@/modules/inbox/filters'
import type { InboxIntelFilter, InboxListFilters, InboxSmartCounts, InboxSort, InboxStatusFilter } from '@/modules/inbox/types'

const STATUS_OPTIONS: { value: InboxStatusFilter; label: string }[] = [
  { value: 'all', label: 'הכל' },
  { value: 'open', label: 'פתוחות' },
  { value: 'closed', label: 'סגורות' },
  { value: 'archived', label: 'בארכיון' },
]

const SORT_OPTIONS: { value: InboxSort; label: string }[] = [
  { value: 'latest', label: 'פעילות אחרונה' },
  { value: 'oldest', label: 'פעילות ישנה' },
  { value: 'unread', label: 'לא נקראו תחילה' },
  { value: 'temperature', label: 'לידים חמים תחילה' },
  { value: 'intent', label: 'לפי כוונת הליד' },
  { value: 'action', label: 'לפי צעד מומלץ' },
]

const INTEL_OPTIONS: { value: InboxIntelFilter; label: string }[] = [
  { value: 'all', label: 'כל השיחות' },
  { value: 'hot', label: 'לידים חמים' },
  { value: 'attention', label: 'דורש טיפול מיידי' },
  { value: 'pricing', label: 'בקשות מחיר' },
  { value: 'demo', label: 'בקשות הדגמה' },
  { value: 'support', label: 'פניות שירות' },
  { value: 'escalation', label: 'אסקלציות שירות' },
  { value: 'followup', label: 'דרוש המשך טיפול' },
]

// Smart sections: count-driven shortcuts to intelligence segments.
const SMART_SECTIONS: { value: InboxIntelFilter; label: string; countKey: keyof InboxSmartCounts }[] = [
  { value: 'hot', label: 'שיחות חמות', countKey: 'hot' },
  { value: 'attention', label: 'דורש טיפול מיידי', countKey: 'attention' },
  { value: 'demo', label: 'הזדמנויות הדגמה', countKey: 'demo' },
  { value: 'escalation', label: 'אסקלציות שירות', countKey: 'escalation' },
]

const SEARCH_DEBOUNCE_MS = 300

export default function InboxToolbar({
  filters,
  selectedConversation,
  smartCounts,
  showMessenger = false,
}: {
  filters: InboxListFilters
  selectedConversation: number | null
  smartCounts: InboxSmartCounts
  /** Messenger rollout gate, resolved server-side by the page. */
  showMessenger?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [qLocal, setQLocal] = useState(filters.q ?? '')

  const apply = (patch: Partial<InboxListFilters>) => {
    const next = { ...filters, ...patch }
    const sp = inboxFiltersToSearchParams(next, { conversation: selectedConversation })
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  useEffect(() => {
    setQLocal(filters.q ?? '')
  }, [filters.q])

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = qLocal.trim() || null
      if (trimmed !== (filters.q ?? null)) apply({ q: trimmed })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal])

  const toggleCls = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
      active ? 'border-info-border bg-primary-tint text-primary-text font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
    }`

  const selectCls =
    'min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 transition-colors focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary'

  const visibleSections = SMART_SECTIONS.filter((s) => smartCounts[s.countKey] > 0)

  return (
    <div className='shrink-0 space-y-2 border-b border-gray-100 p-2'>
      <div className='px-1'>
        <InboxChannelSwitch active='whatsapp' showMessenger={showMessenger} />
      </div>

      {visibleSections.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {visibleSections.map((s) => {
            const active = filters.intel === s.value
            return (
              <button
                key={s.value}
                type='button'
                aria-pressed={active}
                onClick={() => apply({ intel: active ? 'all' : s.value })}
                className={toggleCls(active)}
              >
                {s.label}
                <span className='mr-1 tabular-nums text-gray-400'>{smartCounts[s.countKey]}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className='relative'>
        <Search aria-hidden className='pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400' />
        <input
          type='search'
          inputMode='search'
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          placeholder='חיפוש שם, טלפון או הודעה'
          aria-label='חיפוש שיחות'
          className='w-full rounded-md border border-gray-200 bg-white py-1.5 pl-2.5 pr-8 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary'
        />
      </div>

      <div className='flex gap-1'>
        <select
          aria-label='סטטוס'
          value={filters.status}
          onChange={(e) => apply({ status: e.target.value as InboxStatusFilter })}
          className={selectCls}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label='מיון'
          value={filters.sort}
          onChange={(e) => apply({ sort: e.target.value as InboxSort })}
          className={selectCls}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <select
        aria-label='סינון חכם'
        value={filters.intel}
        onChange={(e) => apply({ intel: e.target.value as InboxIntelFilter })}
        className={`${selectCls} w-full`}
      >
        {INTEL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div className='flex flex-wrap gap-1.5'>
        <button
          type='button'
          aria-pressed={filters.unread}
          onClick={() => apply({ unread: !filters.unread })}
          className={toggleCls(filters.unread)}
        >
          לא נקראו
        </button>
        <button
          type='button'
          aria-pressed={filters.needsReply}
          onClick={() => apply({ needsReply: !filters.needsReply })}
          className={toggleCls(filters.needsReply)}
        >
          ממתינות למענה
        </button>
      </div>
    </div>
  )
}
