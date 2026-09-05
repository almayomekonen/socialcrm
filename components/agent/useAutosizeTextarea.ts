'use client'

import { useLayoutEffect, type RefObject } from 'react'

/**
 * Grow a textarea with its content, up to a ceiling, then scroll.
 *
 * `useLayoutEffect` rather than `useEffect`: the height is measured and written
 * in the same frame as the keystroke that changed the value, so the box never
 * paints at the old height first. An effect here is a visible one-frame jitter
 * while typing the character that wraps a line.
 *
 * The reset to `auto` before reading `scrollHeight` is load-bearing — with an
 * explicit height still set, `scrollHeight` reports the CURRENT box, so the
 * textarea can only ever grow and never shrinks back when text is deleted.
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx: number,
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, maxHeightPx)
    el.style.height = `${next}px`
    // Only the capped textarea scrolls; below the cap an inner scrollbar would
    // appear and disappear on alternating keystrokes.
    el.style.overflowY = el.scrollHeight > maxHeightPx ? 'auto' : 'hidden'
  }, [ref, value, maxHeightPx])
}
