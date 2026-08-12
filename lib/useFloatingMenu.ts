'use client'

import { useEffect, useRef, useState } from 'react'
import { placeFollowUpMenu, type PlaceMenuOpts } from '@/lib/leads/placeFollowUpMenu'

export type MenuPos = { top: number; left: number; width: number }

/**
 * Shared floating-menu mechanics for inline popovers: viewport-aware placement,
 * portal-friendly `fixed` position, and close on outside-click / Escape /
 * OUTSIDE scroll / resize. Mirrors FollowUpControl's behavior so new triggers (e.g.
 * OutcomeControl compact) reuse it exactly. (FollowUpControl can migrate to this
 * later; left untouched for now to avoid regressing a tested surface.)
 */
export function useFloatingMenu(opts?: PlaceMenuOpts) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function openMenu() {
    const el = wrapRef.current
    if (!el) return
    setPos(
      placeFollowUpMenu(
        el.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        // Optional so every existing caller keeps the 224px action-menu default;
        // a wider surface (the notification panel) passes its own size rather
        // than forking the hook (P2.3).
        opts,
      ),
    )
    setOpen(true)
  }

  function close() {
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    /** Inside the trigger or the menu — including across a portal boundary. */
    function isOurs(t: Node): boolean {
      return !!wrapRef.current?.contains(t) || !!menuRef.current?.contains(t)
    }
    function onDocClick(e: MouseEvent) {
      if (isOurs(e.target as Node)) return
      close()
    }
    /**
     * Close when the PAGE moves under the menu, not when the menu scrolls itself.
     *
     * `capture: true` is load-bearing: a scroll on an element does not bubble, and
     * this app's pages scroll inner containers rather than the window, so capture
     * is the only phase in which a window listener hears them at all. But capture
     * also delivers scrolls from inside the menu, and closing on those makes any
     * menu with a scrollable region unusable — the notification panel could not be
     * scrolled at all, because the first wheel event dismissed it.
     *
     * So the same containment question the outside-click path asks is asked here.
     * Consumers with no scrollable descendants cannot reach the early return and
     * behave exactly as before.
     */
    function onScroll(e: Event) {
      const t = e.target
      if (t instanceof Node && isOurs(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return { open, pos, wrapRef, menuRef, openMenu, close, toggle: () => (open ? close() : openMenu()) }
}
