'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'

/**
 * Search over שיחות. URL-backed, exactly like the lead list's filter bar:
 * `/inbox?q=…`, so refresh, back/forward, deep links and sharing all work.
 *
 * Reuses the EXISTING inbox `q` filter (`InboxListFilters.q`) — the same field
 * the desktop toolbar sets — so there is one search vocabulary, not two.
 *
 * Commits on submit, not per keystroke: a navigation per character would push a
 * history entry per character and make the back button useless.
 */
export default function ConversationSearchBar({ q, resultCount }: { q: string; resultCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState(q)

  useEffect(() => setText(q), [q])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = text.trim()
    startTransition(() => router.push((next ? `/inbox?q=${encodeURIComponent(next)}` : '/inbox') as never))
  }

  return (
    <div className='sticky top-0 z-20 border-b border-gray-200 bg-white px-4 pb-2.5 pt-3'>
      <form onSubmit={submit} role='search' className='relative'>
        <label htmlFor='conversation-search' className='sr-only'>
          חיפוש שיחות
        </label>
        <input
          id='conversation-search'
          type='search'
          inputMode='search'
          enterKeyHint='search'
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='חיפוש שיחה'
          className='h-11 w-full rounded-lg border border-gray-200 bg-gray-50 ps-9 pe-3 text-[15px] outline-none focus:border-primary focus:bg-white'
        />
        <Icon
          name='magnifying-glass'
          type='reg'
          className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 bg-gray-400'
        />
      </form>

      {q && (
        <div className='mt-2 flex items-center'>
          <button
            type='button'
            onClick={() => startTransition(() => router.push('/inbox' as never))}
            className='inline-flex h-11 min-w-11 items-center gap-1 px-1 text-[13px] font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            aria-label='נקה חיפוש'
          >
            <span>{`"${q}"`}</span>
            <span aria-hidden className='text-[13px] leading-none text-gray-400'>
              ×
            </span>
          </button>
        </div>
      )}

      <p aria-live='polite' className='mt-1.5 text-[12px] tabular-nums text-gray-400'>
        {pending ? 'מעדכן…' : `${resultCount} שיחות`}
      </p>
    </div>
  )
}
