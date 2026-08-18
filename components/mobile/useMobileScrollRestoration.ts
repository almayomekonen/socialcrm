'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Scroll restoration for the mobile workspace's own scroll container (A2a-1).
 *
 * THE MEASURED DEFECT. `/leads` scrolled to 600 → open a lead → back → 0, at
 * all four phone widths. A rep working down a list loses their place on every
 * single lead they open, which is the core mobile loop.
 *
 * THE CAUSE, verified. `MobileWorkspaceShell` makes `main#main-content` the sole
 * scroll container (`overflow-y-auto`); the document itself never scrolls.
 * Browser and Next history scroll restoration both operate on the DOCUMENT
 * scroller, so there is nothing for either to restore.
 *
 * WHY NOT MOVE SCROLLING TO THE DOCUMENT. That inner scroller is what makes the
 * shell's sticky architecture correct — header, filter bar, sticky lead actions,
 * tab bar and safe-area insets all measured clean precisely because they are
 * siblings of a self-contained scroll region. Trading a measured-good layout for
 * free scroll restoration would be a bad exchange, so restoration is implemented
 * explicitly instead.
 *
 * SCOPE. This is the mobile shell's scroller and nothing else — not a global
 * scroll manager, not a router patch, and not something desktop can reach. It is
 * a hook rather than shell code so the shell stays a rendering component
 * (architecture-rules.md §3).
 *
 * ── The three rules that make it correct ────────────────────────────────────
 *
 * 1. RESTORE ONLY ON A HISTORY POP. A position is re-applied only when the
 *    navigation into the URL was back/forward (`popstate`). A fresh load, a
 *    reload, a tapped link and a filter change are all pushes, so they start at
 *    the top — which is what "direct page loads start at the top" requires, and
 *    is also why a reload cannot resurrect a stale offset out of sessionStorage.
 *
 * 2. THE KEY IS THE FULL URL, params included and order-normalised. A different
 *    filter or search is a different key, so a changed list state has no saved
 *    entry to restore and correctly begins at the top. This is what keeps
 *    `?status=new` from inheriting `?status=lost`'s offset — no heuristic about
 *    "is this the same list" is needed, because the URL already answers it.
 *
 * 3. THE POSITION IS SAVED AT NAVIGATION INTENT, NOT ON SCROLL.
 *
 *    This is the subtle one, and the first implementation got it wrong. Saving
 *    from a scroll listener looks obvious and is racy: when the router swaps the
 *    route's content, the scroller resets to 0 and fires a scroll event *while
 *    `location` is still the outgoing URL*, so the listener overwrites the real
 *    offset with 0 under the outgoing page's own key. Measured directly — the
 *    saved entry was gone 100ms after leaving `/leads`.
 *
 *    Instead the position is read in a CAPTURE-phase click listener, which runs
 *    before the router handles the navigation: at that instant `location` is
 *    unambiguously the page being left and `scrollTop` is unambiguously where
 *    the user actually is. `pagehide` covers full-page navigations. No scroll
 *    listener exists at all, which is also cheaper on a phone.
 *
 *    Reading `window.location` at event time (rather than from a React
 *    dependency) additionally keeps `useSearchParams()` out of the shell, which
 *    would otherwise force a Suspense boundary around every mobile route for a
 *    client-only concern.
 */

const PREFIX = 'mws:scroll:'
/** Bounded so a long session cannot grow sessionStorage without limit. */
const MAX_ENTRIES = 40
/**
 * Frame budget for a restore, and how many consecutive frames the position must
 * hold before we stop re-applying it.
 *
 * WHY A FRAME LOOP AND NOT A ONE-SHOT SET. Measured: on `popstate` the handler
 * runs BEFORE React re-renders, and Next's own router then resets the nearest
 * scrollable ancestor to 0 in an effect after commit. A single assignment — even
 * a correct one — is therefore always clobbered, which is exactly what the first
 * version of this hook did and why the fix measured as a no-op.
 *
 * A MutationObserver is not enough either: the router's reset lands AFTER the
 * final DOM mutation, so there is no further commit to react to.
 *
 * These are frame counts, not wall-clock delays: the loop re-applies once per
 * animation frame and exits as soon as the value has held for `STABLE_FRAMES`,
 * which in practice is a few milliseconds. `MAX_FRAMES` is only a give-up budget
 * so a page that never grows tall enough cannot loop forever.
 */
const MAX_FRAMES = 90
const STABLE_FRAMES = 3

/** `/leads?status=new,contacted` → a stable key with params in a fixed order. */
function keyFor(loc: Location): string {
  const params = new URLSearchParams(loc.search)
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const qs = new URLSearchParams(sorted).toString()
  return PREFIX + loc.pathname + (qs ? '?' + qs : '')
}

function read(key: string): number {
  try {
    const raw = sessionStorage.getItem(key)
    const n = raw == null ? 0 : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    // Private mode / storage disabled: restoration is a nicety, never a
    // dependency. Losing it must not break navigation.
    return 0
  }
}

function write(key: string, value: number) {
  try {
    if (value <= 0) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, String(value))

    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
    // Oldest-inserted first; sessionStorage preserves insertion order well
    // enough for an eviction policy whose only job is bounding growth.
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
      sessionStorage.removeItem(k)
    }
  } catch {
    /* storage full or unavailable — see read() */
  }
}

export function useMobileScrollRestoration(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    /* ---- save ------------------------------------------------------------
     * Capture phase, so this runs before the router reacts to the click and
     * while `location` still identifies the page being left. A click that does
     * not navigate (opening a sheet, toggling a chip) simply re-saves the
     * current page's current offset, which is harmless and correct. */
    const save = () => write(keyFor(window.location), el.scrollTop)
    document.addEventListener('click', save, true)
    window.addEventListener('pagehide', save)

    /* ---- restore --------------------------------------------------------- */
    let restoreRaf = 0

    const stop = () => {
      if (restoreRaf) cancelAnimationFrame(restoreRaf)
      restoreRaf = 0
    }

    const onPopState = () => {
      stop()
      // `popstate` fires after `location` has already become the destination,
      // so this reads the key of the page being returned TO.
      const target = read(keyFor(window.location))
      if (!target) return

      let frames = 0
      let stable = 0

      const tick = () => {
        restoreRaf = 0
        frames++

        // Assigning past the current maximum is silently clamped, so the offset
        // can only be honoured once the content is actually tall enough — which
        // on a streamed route may be several frames in.
        const reachable = el.scrollHeight - el.clientHeight >= target
        if (reachable && Math.abs(el.scrollTop - target) > 2) el.scrollTop = target

        stable = reachable && Math.abs(el.scrollTop - target) <= 2 ? stable + 1 : 0

        // Held across enough frames to have survived the router's own reset.
        if (stable >= STABLE_FRAMES || frames >= MAX_FRAMES) return
        restoreRaf = requestAnimationFrame(tick)
      }

      restoreRaf = requestAnimationFrame(tick)
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      document.removeEventListener('click', save, true)
      window.removeEventListener('pagehide', save)
      window.removeEventListener('popstate', onPopState)
      stop()
    }
  }, [ref])
}

/** Exported for the regression suite — the key rule is the whole correctness argument. */
export const __test = { keyFor, PREFIX }
