'use client'

import { useLayoutEffect, type RefObject } from 'react'

/**
 * Grow a textarea with its content instead of scrolling inside a fixed box.
 *
 * The textarea's `rows` stays its minimum height: the height is reset to `auto`
 * first, so deleting text shrinks it back. `scrollHeight` rather than CSS
 * `field-sizing: content`, which Firefox and older Safari do not support — the
 * same measurement the Copilot composer uses.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}
