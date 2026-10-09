'use client'

/**
 * A box opened for editing stays on screen. Clicking "עריכה" on a box low on
 * the map expands it downwards, past the bottom of the canvas; the owner then
 * had to scroll again to reach what they came to edit. Once the opened box has
 * its expanded size, the map pans (same zoom, once, briefly; at once for
 * reduced motion) just enough to show it. Presentation only: no box moves on
 * the map, nothing is saved.
 *
 * A box taller than the canvas is shown from its top, where its question is.
 * A box brought into view another way (a new question, "אחר → עריכה") is left
 * to that; a box already fully visible does not move the map at all.
 */
import { useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, type Viewport } from '@xyflow/react'

export type Rect = { x: number; y: number; width: number; height: number }

/** Room kept between an opened box and the canvas edge. */
const MARGIN = 24
/** If the box's size never changes (it opened at the size it had), act anyway after this long. */
const SETTLE_MS = 400

/** The smallest pan that shows `box` (map coordinates) inside a `view` of the canvas, or null if it already shows. */
export function panToShow(box: Rect, viewport: Viewport, view: { width: number; height: number }): Viewport | null {
  const { zoom } = viewport
  const shift = (start: number, size: number, room: number) => {
    const end = start + size
    if (size + 2 * MARGIN > room || start < MARGIN) return MARGIN - start
    if (end > room - MARGIN) return room - MARGIN - end
    return 0
  }
  const dx = view.width ? shift(box.x * zoom + viewport.x, box.width * zoom, view.width) : 0
  const dy = view.height ? shift(box.y * zoom + viewport.y, box.height * zoom, view.height) : 0
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null
  return { x: viewport.x + dx, y: viewport.y + dy, zoom }
}

/**
 * `rect(id)` is the box as laid out and measured right now (null until it is).
 * `revealing` is the box another effect is already bringing into view.
 */
export function useKeepOpenBoxInView(selected: string | null, revealing: string | null, rect: (id: string) => Rect | null) {
  const flow = useReactFlow()
  const view = useStore((s) => ({ width: s.width, height: s.height }), (a, b) => a.width === b.width && a.height === b.height)
  // The box just opened and its size at that moment: it is shown once its
  // expanded size has been measured (and laid out), or after SETTLE_MS.
  const pending = useRef<{ id: string; height: number | null; settled: boolean } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const opened = selected && selected !== revealing ? { id: selected, height: rect(selected)?.height ?? null, settled: false } : null
    pending.current = opened
    if (!opened) return
    const timer = setTimeout(() => {
      opened.settled = true
      setTick((n) => n + 1)
    }, SETTLE_MS)
    return () => clearTimeout(timer)
    // Only a new opening starts this; its sizes are read below as they arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const box = selected ? rect(selected) : null
  useEffect(() => {
    const p = pending.current
    if (!p || p.id !== selected || !box) return
    const expanded = p.height !== null && Math.abs(box.height - p.height) > 1
    if (!expanded && !p.settled) return
    pending.current = null
    const next = panToShow(box, flow.getViewport(), view)
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (next) void flow.setViewport(next, { duration: still ? 0 : 200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, box?.x, box?.y, box?.width, box?.height, tick])
}
