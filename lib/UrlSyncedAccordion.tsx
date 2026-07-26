'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Keeps a group of native <details id="..."> in sync with a URL query param
 * (default `section`), making the URL the single source of truth for which
 * section is open. Reuses AccordionItem unchanged — just give each an `id`.
 *
 * The server already derives each item's `open` from the same param, so SSR,
 * refresh and direct deep-links are correct on their own. The one thing the
 * server cannot see is a *manual* open/close, and that is the whole bug: without
 * it, React's committed `open` drifts from the DOM and a later navigation to the
 * same URL is a no-op that never resets the accordion.
 *
 * So here we only close that loop: on any manual toggle we write the currently
 * open section straight back to the URL (router.replace, no scroll, no history
 * spam). That keeps React's committed `open` in step with reality, so every
 * subsequent navigation to ?<param>=<id> is a genuine prop change that
 * deterministically re-applies — regardless of manual interaction, history, or
 * App Router cache reuse.
 *
 * Generic: a future settings section just adds an AccordionItem with an `id`
 * inside this wrapper.
 */
// Explicit "all sections collapsed" URL value. Any non-section param value
// resolves to all-closed server-side; this names the one we write on close.
const ALL_COLLAPSED = 'none'

export default function UrlSyncedAccordion({
  param = 'section',
  className,
  children,
}: {
  param?: string
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLDetailsElement>('details[id]'))

    const onToggle = () => {
      const openId = items.find((d) => d.open)?.id ?? null
      // "Nothing open" is an explicit, URL-representable state (?section=none),
      // NOT the absence of the param. Deleting the param would let the server fall
      // back to its no-param default (Facebook open), so closing the active
      // section would silently re-open one. Writing the sentinel keeps all-closed
      // as-is; the server already renders every section closed for `none`.
      const target = openId ?? ALL_COLLAPSED
      // Read the live URL so the guard is never stale (avoids reacting to the
      // programmatic toggles React fires while applying a navigation).
      const current = new URLSearchParams(window.location.search)
      if (current.get(param) === target) return
      current.set(param, target)
      router.replace(`${pathname}?${current.toString()}`, { scroll: false })
    }

    items.forEach((d) => d.addEventListener('toggle', onToggle))
    return () => items.forEach((d) => d.removeEventListener('toggle', onToggle))
  }, [param, pathname, router])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
