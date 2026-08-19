'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import BottomSheet from '@/components/mobile/BottomSheet'
import { STATUS_STYLES } from '@/lib/leads/statusStyles'
import { LEAD_STATUSES, leadsHref, type LeadFilters } from '@/modules/leads/filters'

/**
 * Search + status filtering for the mobile lead list.
 *
 * URL IS THE STATE. Every change navigates to `/leads?q=…&status=…` rather than
 * setting local state, so refresh, back/forward, deep links and sharing all
 * behave like the web — the four things the desktop table's twelve `useState`s
 * cannot do. This component holds exactly one piece of local state (the search
 * input's uncommitted text) and it is reset from the URL whenever the URL wins.
 *
 * NO CLIENT-SIDE FILTERING. Submitting navigates and the server re-queries with
 * the filters applied in SQL. The list is never fetched whole and sliced in the
 * browser.
 *
 * NO DEBOUNCE. Search commits on submit (the keyboard's enter/search key) or on
 * the explicit button — not on every keystroke. On a phone that is both the
 * cheaper and the more predictable behaviour: a per-keystroke navigation would
 * push a history entry per character and make the back button useless.
 */
export default function LeadFilterBar({ filters, resultCount }: { filters: LeadFilters; resultCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState(filters.q)
  const [sheetOpen, setSheetOpen] = useState(false)

  // The URL is the source of truth: if it changes underneath us (back button,
  // a chip cleared elsewhere), the input follows it rather than fighting it.
  useEffect(() => setText(filters.q), [filters.q])

  const go = (next: LeadFilters) => {
    setSheetOpen(false)
    startTransition(() => router.push(leadsHref(next) as never))
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    go({ ...filters, q: text.trim() })
  }

  const toggleStatus = (s: (typeof LEAD_STATUSES)[number]) => {
    const has = filters.status.includes(s)
    go({ ...filters, status: has ? filters.status.filter((x) => x !== s) : [...filters.status, s] })
  }

  const activeCount = filters.status.length
  const hasAny = activeCount > 0 || filters.q.length > 0

  return (
    /**
     * PRIMARY TOOLBAR IS ONE ROW: search + filter icon.
     *
     * Active-filter tokens never share that row — at 360px they stole width
     * from the input and dropped the filter onto a second line. Tokens sit
     * BELOW, only when something is active, as quiet state — not a bubble tray.
     */
    <div className='sticky top-0 z-20 border-b border-gray-200 bg-white px-3 pb-2 pt-2.5'>
      <div data-testid='lead-search-filter-row' className='flex items-center gap-2'>
        <form onSubmit={submitSearch} role='search' className='relative min-w-0 flex-1'>
          <label htmlFor='lead-search' className='sr-only'>
            חיפוש לידים
          </label>
          <input
            id='lead-search'
            type='search'
            inputMode='search'
            enterKeyHint='search'
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='חיפוש לפי שם או טלפון'
            className='h-11 w-full rounded-lg border border-gray-200 bg-gray-50 ps-9 pe-3 text-base outline-none focus:border-primary focus:bg-white'
          />
          <Icon
            name='magnifying-glass'
            type='reg'
            className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 bg-gray-400'
          />
        </form>

        <button
          type='button'
          onClick={() => setSheetOpen(true)}
          aria-haspopup='dialog'
          aria-label={activeCount ? `סינון לפי סטטוס, ${activeCount} נבחרו` : 'סינון לפי סטטוס'}
          className={`relative flex size-11 shrink-0 items-center justify-center rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            activeCount ? 'border-primary bg-primary-tint' : 'border-gray-200 bg-white'
          }`}
        >
          <Icon name='filter' type='sol' className={`size-4 ${activeCount ? 'bg-primary' : 'bg-gray-600'}`} />
          {activeCount > 0 && (
            <span
              aria-hidden
              className='absolute -top-1 -end-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white'
            >
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {hasAny && (
        <div
          data-testid='lead-active-filters'
          className='mt-0.5 flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          {filters.q && (
            <ActiveFilter label={`"${filters.q}"`} onClear={() => go({ ...filters, q: '' })} clearLabel='נקה חיפוש' />
          )}
          {filters.status.map((s) => (
            <ActiveFilter
              key={s}
              label={STATUS_STYLES[s]?.label ?? s}
              dot={STATUS_STYLES[s]?.dot}
              onClear={() => toggleStatus(s)}
              clearLabel={`הסר ${STATUS_STYLES[s]?.label ?? s}`}
            />
          ))}
          <button
            type='button'
            onClick={() => go({ q: '', status: [] })}
            className='flex h-11 shrink-0 items-center px-2 text-[12px] font-medium text-primary-text underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            נקה הכל
          </button>
        </div>
      )}

      <p aria-live='polite' className='mt-1 text-[11px] tabular-nums leading-none text-gray-400'>
        {pending ? 'מעדכן…' : `${resultCount} לידים`}
      </p>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title='סינון לפי סטטוס'>
        <div className='flex flex-col gap-2'>
          {LEAD_STATUSES.map((s) => {
            const on = filters.status.includes(s)
            const style = STATUS_STYLES[s]
            return (
              <button
                key={s}
                type='button'
                onClick={() => toggleStatus(s)}
                aria-pressed={on}
                className={`flex min-h-12 items-center gap-3 rounded-lg border px-4 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  on ? 'border-primary bg-primary-tint' : 'border-gray-200 bg-white'
                }`}
              >
                <span className={`size-2.5 rounded-full ${style?.dot ?? 'bg-gray-400'}`} />
                <span className='flex-1 text-[15px] font-medium text-ink'>{style?.label ?? s}</span>
                {on && <Icon name='check' type='sol' className='size-4 bg-primary' />}
              </button>
            )
          })}
          <button
            type='button'
            onClick={() => go({ ...filters, status: [] })}
            className='mt-1 min-h-11 rounded-lg px-4 text-[14px] font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            כל הסטטוסים
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}

/**
 * An active filter, as a toolbar control — not a floating pill.
 *
 * THE WHOLE CONTROL IS THE BUTTON. A nested 24×24 `×` was measured below the
 * 44px minimum. One button, `h-11 min-w-11`, with the `×` as a visual affordance
 * only. Chrome (capsule fill, border, rounded-full) was dropped so the strip
 * reads as part of the search/filter bar rather than content above the list.
 */
function ActiveFilter({
  label,
  dot,
  onClear,
  clearLabel,
}: {
  label: string
  dot?: string
  onClear: () => void
  clearLabel: string
}) {
  return (
    <button
      type='button'
      onClick={onClear}
      aria-label={clearLabel}
      className='inline-flex h-11 min-w-11 shrink-0 items-center gap-1 px-2 text-[13px] font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />}
      <span className='text-[13px] font-medium text-gray-700'>{label}</span>
      <span aria-hidden className='text-[13px] leading-none text-gray-400'>
        ×
      </span>
    </button>
  )
}
