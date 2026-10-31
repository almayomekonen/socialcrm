'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * A search field that ACTUALLY SEARCHES on day one.
 *
 * A decorative box "for future functionality" would break the never-ship-
 * non-functional-UI rule and the care charter's honesty laws at the same time.
 * This filters the knowledge-base registry and navigates to the results.
 *
 * VISUALLY SECONDARY, deliberately. It sits below the actions and is styled as
 * a quiet input, not a hero bar: someone arriving because something is broken
 * must land on "יש לי תקלה" first. Search serves the person who is learning,
 * not the person who is stuck.
 *
 * Submit-on-enter rather than search-as-you-type: navigating per keystroke is
 * the stutter frontend-experience-guidelines.md §11 warns about, and the
 * registry is small enough that one deliberate submit is faster to use.
 */
export default function SupportSearch({
  className = '',
  initialQuery = '',
}: {
  className?: string
  initialQuery?: string
}) {
  const router = useRouter()
  const t = useT()
  const [q, setQ] = useState(initialQuery)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = q.trim()
    startTransition(() => {
      router.push(trimmed ? `/support/guides?q=${encodeURIComponent(trimmed)}` : '/support/guides')
    })
  }

  return (
    <form onSubmit={submit} className={className} role='search'>
      <label htmlFor='support-search' className='block text-sm font-medium text-gray-500'>
        {t('support.search.label')}
      </label>
      <div className='mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 focus-within:border-primary'>
        <Icon name='magnifying-glass' type='reg' className='size-4 shrink-0 bg-gray-400' />
        <input
          id='support-search'
          type='search'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('support.search.placeholder')}
          className='h-11 min-w-0 flex-1 bg-transparent text-sm outline-none'
        />
        {pending && <span className='shrink-0 text-xs text-gray-400'>{t('support.search.searching')}</span>}
      </div>
    </form>
  )
}
