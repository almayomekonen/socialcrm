'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import InboxChannelSwitch from './InboxChannelSwitch'
import { inboxFiltersToSearchParams } from '@/modules/inbox/filters'
import type { InboxIntelFilter, InboxListFilters, InboxSmartCounts, InboxSort, InboxStatusFilter } from '@/modules/inbox/types'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'

const STATUS_OPTIONS: { value: InboxStatusFilter; label: MessageKey }[] = [
  { value: 'all', label: 'inbox.toolbar.status.all' },
  { value: 'open', label: 'inbox.toolbar.status.open' },
  { value: 'closed', label: 'inbox.toolbar.status.closed' },
  { value: 'archived', label: 'inbox.toolbar.status.archived' },
]

const SORT_OPTIONS: { value: InboxSort; label: MessageKey }[] = [
  { value: 'latest', label: 'inbox.toolbar.sort.latest' },
  { value: 'oldest', label: 'inbox.toolbar.sort.oldest' },
  { value: 'unread', label: 'inbox.toolbar.sort.unread' },
  { value: 'temperature', label: 'inbox.toolbar.sort.temperature' },
  { value: 'intent', label: 'inbox.toolbar.sort.intent' },
  { value: 'action', label: 'inbox.toolbar.sort.action' },
]

const INTEL_OPTIONS: { value: InboxIntelFilter; label: MessageKey }[] = [
  { value: 'all', label: 'inbox.toolbar.intel.all' },
  { value: 'hot', label: 'inbox.toolbar.intel.hot' },
  { value: 'attention', label: 'inbox.toolbar.intel.attention' },
  { value: 'pricing', label: 'inbox.toolbar.intel.pricing' },
  { value: 'demo', label: 'inbox.toolbar.intel.demo' },
  { value: 'support', label: 'inbox.toolbar.intel.support' },
  { value: 'escalation', label: 'inbox.toolbar.intel.escalation' },
  { value: 'followup', label: 'inbox.toolbar.intel.followup' },
]

// Smart sections: count-driven shortcuts to intelligence segments. Labels are
// catalog keys; the option VALUES are the filter codes the URL carries.
const SMART_SECTIONS: { value: InboxIntelFilter; label: MessageKey; countKey: keyof InboxSmartCounts }[] = [
  { value: 'hot', label: 'inbox.toolbar.smart.hot', countKey: 'hot' },
  { value: 'attention', label: 'inbox.toolbar.smart.attention', countKey: 'attention' },
  { value: 'demo', label: 'inbox.toolbar.smart.demo', countKey: 'demo' },
  { value: 'escalation', label: 'inbox.toolbar.smart.escalation', countKey: 'escalation' },
]

const SEARCH_DEBOUNCE_MS = 300

/** Physical classes that sit on the reading start/end; RTL keeps the legacy classes exactly. */
const SIDE = {
  rtl: { count: 'mr-1', icon: 'right-2.5', input: 'pl-2.5 pr-8' },
  ltr: { count: 'ml-1', icon: 'left-2.5', input: 'pr-2.5 pl-8' },
} as const

export default function InboxToolbar({
  filters,
  selectedConversation,
  smartCounts,
  showMessenger = false,
  messengerUnread = 0,
}: {
  filters: InboxListFilters
  selectedConversation: number | null
  smartCounts: InboxSmartCounts
  /** Messenger rollout gate, resolved server-side by the page. */
  showMessenger?: boolean
  /** Unread Messenger conversations for this user; resolved on the server. */
  messengerUnread?: number
}) {
  const t = useT()
  const side = SIDE[dirFor(t.locale)]
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
        <InboxChannelSwitch active='whatsapp' showMessenger={showMessenger} messengerUnread={messengerUnread} locale={t.locale} />
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
                {t(s.label)}
                <span className={`${side.count} tabular-nums text-gray-400`}>{smartCounts[s.countKey]}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className='relative'>
        <Search aria-hidden className={`pointer-events-none absolute ${side.icon} top-1/2 size-4 -translate-y-1/2 text-gray-400`} />
        <input
          type='search'
          inputMode='search'
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          placeholder={t('inbox.toolbar.searchPlaceholder')}
          aria-label={t('inbox.toolbar.searchLabel')}
          className={`w-full rounded-md border border-gray-200 bg-white py-1.5 ${side.input} text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary`}
        />
      </div>

      <div className='flex gap-1'>
        <select
          aria-label={t('inbox.toolbar.status.label')}
          value={filters.status}
          onChange={(e) => apply({ status: e.target.value as InboxStatusFilter })}
          className={selectCls}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('inbox.toolbar.sort.label')}
          value={filters.sort}
          onChange={(e) => apply({ sort: e.target.value as InboxSort })}
          className={selectCls}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </div>

      <select
        aria-label={t('inbox.toolbar.intel.label')}
        value={filters.intel}
        onChange={(e) => apply({ intel: e.target.value as InboxIntelFilter })}
        className={`${selectCls} w-full`}
      >
        {INTEL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
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
          {t('inbox.toolbar.unread')}
        </button>
        <button
          type='button'
          aria-pressed={filters.needsReply}
          onClick={() => apply({ needsReply: !filters.needsReply })}
          className={toggleCls(filters.needsReply)}
        >
          {t('inbox.toolbar.needsReply')}
        </button>
      </div>
    </div>
  )
}
