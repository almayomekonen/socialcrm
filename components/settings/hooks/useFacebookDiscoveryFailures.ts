'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * How many times this setup session has hit the same Facebook Page-discovery
 * failure (`no_pages` / `pages_permission`). Split from FacebookConnect; the
 * behaviour is unchanged. `pastDiscovery`: a Page is connected or offered.
 */
export function useFacebookDiscoveryFailures(urlError: string | null, pastDiscovery: boolean): number {
  // Session-scoped failure memory — breaks the "no_pages → connect → no_pages"
  // loop (the Oren 2026-07-21 incident: 9 identical failures). Counts repeated
  // Page-discovery failures in this setup session; after the 2nd we escalate the
  // guidance rather than re-offering a prominent, likely-futile retry. Cleared
  // once the flow moves past discovery (Pages found, or connected).
  const [repeatCount, setRepeatCount] = useState(0)
  const countedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (pastDiscovery) {
      window.sessionStorage.removeItem('fbfail:no_pages')
      window.sessionStorage.removeItem('fbfail:pages_permission')
      return
    }
    if (countedRef.current) return
    if (urlError === 'no_pages' || urlError === 'pages_permission') {
      countedRef.current = true
      const key = `fbfail:${urlError}`
      const n = Number(window.sessionStorage.getItem(key) ?? '0') + 1
      window.sessionStorage.setItem(key, String(n))
      setRepeatCount(n)
    }
  }, [urlError, pastDiscovery])

  return repeatCount
}
