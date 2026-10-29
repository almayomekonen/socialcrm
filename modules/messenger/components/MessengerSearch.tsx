'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Filter the Messenger conversation list.
 *
 * STATE LIVES IN THE URL (`?q=`), like the rest of the CRM's list filters. That
 * is what makes back/forward restore the list the rep left, and a link to a
 * filtered view shareable. It also means the filter is applied in SQL over the
 * agency's whole history rather than over the 50 rows already on screen — a
 * search that only looked at the loaded page would say "nothing found" about a
 * conversation that exists.
 *
 * DEBOUNCED, because each keystroke would otherwise be a server round trip and
 * the list would stutter. The input is controlled locally so typing stays
 * instant while the navigation catches up.
 *
 * Selecting a conversation (`c`) is dropped when the query changes: keeping it
 * would leave a thread open that the filtered list no longer contains.
 */
const DEBOUNCE_MS = 250

export default function MessengerSearch({ initial, locale = 'he' }: { initial: string; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The URL is the source of truth: back/forward, or a fresh link, wins over
  // whatever was typed before.
  useEffect(() => setValue(initial), [initial])

  const push = (next: string) => {
    const search = new URLSearchParams(params.toString())
    if (next.trim()) search.set('q', next.trim())
    else search.delete('q')
    search.delete('c')
    router.replace(`${pathname}${search.toString() ? `?${search}` : ''}`, { scroll: false })
  }

  const onChange = (next: string) => {
    setValue(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => push(next), DEBOUNCE_MS)
  }

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    setValue('')
    push('')
  }

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), [])

  return (
    <div className='relative'>
      <label htmlFor='messenger-search' className='sr-only'>
        {t('inbox.messenger.search.label')}
      </label>
      <Search aria-hidden className='pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400' />
      <input
        id='messenger-search'
        type='search'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            clear()
          }
        }}
        placeholder={t('inbox.messenger.search.placeholder')}
        // The browser's own clear button would bypass the debounce and leave
        // the URL stale; ours is the only one.
        className='w-full rounded-md border border-gray-200 bg-white py-1.5 pe-8 ps-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <button
          type='button'
          onClick={clear}
          aria-label={t('inbox.messenger.search.clear')}
          title={t('inbox.messenger.search.clear')}
          className='absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
        >
          <X aria-hidden className='size-3.5' />
        </button>
      )}
    </div>
  )
}
