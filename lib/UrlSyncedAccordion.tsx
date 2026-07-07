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
      // Read the live URL so the guard is never stale (avoids reacting to the
      // programmatic toggles React fires while applying a navigation).
      const current = new URLSearchParams(window.location.search)
      if ((current.get(param) ?? null) === openId) return
      if (openId) current.set(param, openId)
      else current.delete(param)
      const qs = current.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
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
