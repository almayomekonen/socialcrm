'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Route } from 'next'
import { isPerformanceFilterPath, persistFilter, readPersistedFilter } from '@/lib/filter/performanceFilter'

/**
 * Keeps the remembered Performance filter in step with the URL.
 *
 * - `?filter=` present → it becomes the remembered filter (apply, chip removal,
 *   saved filter, tab switch all land here).
 * - no `?filter=` but one is remembered → navigate to it (`router.replace`).
 *   A full load already rendered it server-side (see resolvePerformanceFilter);
 *   a client navigation (sidebar link) may have been served from Next's router
 *   cache, which is keyed by URL and not by this cookie, so only a real
 *   navigation guarantees the data matches the URL. Updating the URL alone
 *   (history.replaceState) was tried and left URL and data disagreeing.
 *
 * Reset is explicit: the reset controls clear the cookie before navigating, so
 * this hook then finds nothing to restore.
 */
export function usePersistedPerformanceFilter(userId: number | undefined, pathname: string, urlFilter: string | null) {
  const router = useRouter()

  useEffect(() => {
    if (!userId || !isPerformanceFilterPath(pathname)) return
    if (urlFilter) {
      persistFilter(userId, urlFilter)
      return
    }
    const stored = readPersistedFilter(userId)
    if (stored) router.replace(`${pathname}?filter=${encodeURIComponent(stored)}` as Route, { scroll: false })
  }, [userId, pathname, urlFilter, router])
}
