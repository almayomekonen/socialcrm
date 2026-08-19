'use client'

import { useCallback, useEffect, useRef } from 'react'

/** Hold duration before selection/action mode. Long enough to beat a tap, short enough to feel native. */
export const LONG_PRESS_MS = 480
/** Cancel if the pointer travels further than this (scroll / swipe). */
export const LONG_PRESS_MOVE_PX = 10

export type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  onPointerLeave: (e: React.PointerEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onClickCapture: (e: React.MouseEvent) => void
}

function nestedInteractive(target: EventTarget | null, current: EventTarget | null): boolean {
  if (!(target instanceof Element) || !(current instanceof Element)) return false
  const hit = target.closest('button, a, input, textarea, select, [role="button"], [role="link"]')
  return hit != null && hit !== current && current.contains(hit)
}

function scrollParent(el: HTMLElement | null): EventTarget {
  let cur: HTMLElement | null = el
  while (cur) {
    const { overflowY } = getComputedStyle(cur)
    if ((overflowY === 'auto' || overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return window
}

/**
 * Touch-first long press. Enters selection/action mode — never a destructive
 * action by itself. Timer lives on the element; the only extra listener is a
 * scroll cancel attached for the duration of the press.
 */
export default function useLongPress(onLongPress: () => void, enabled = true): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const scrollTargetRef = useRef<EventTarget | null>(null)
  const onLongPressRef = useRef(onLongPress)
  onLongPressRef.current = onLongPress

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startRef.current = null
    if (scrollTargetRef.current) {
      scrollTargetRef.current.removeEventListener('scroll', clear as EventListener)
      scrollTargetRef.current = null
    }
  }, [])

  useEffect(() => () => clear(), [clear])

  const fire = useCallback(() => {
    firedRef.current = true
    suppressClickRef.current = true
    clear()
    onLongPressRef.current()
  }, [clear])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (nestedInteractive(e.target, e.currentTarget)) return
      firedRef.current = false
      suppressClickRef.current = false
      startRef.current = { x: e.clientX, y: e.clientY }
      const host = e.currentTarget as HTMLElement
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        /* jsdom / older WebKit */
      }
      const scroller = scrollParent(host)
      scrollTargetRef.current = scroller
      scroller.addEventListener('scroll', clear as EventListener, { passive: true })
      timerRef.current = setTimeout(fire, LONG_PRESS_MS)
    },
    [clear, enabled, fire],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startRef.current || !timerRef.current) return
      const dx = e.clientX - startRef.current.x
      const dy = e.clientY - startRef.current.y
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) clear()
    },
    [clear],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      clear()
    },
    [clear],
  )

  const onPointerCancel = useCallback(() => {
    if (!firedRef.current) suppressClickRef.current = false
    clear()
  }, [clear])

  const onPointerLeave = useCallback((e: React.PointerEvent) => {
    // jsdom fires pointerleave with a null relatedTarget on pointerdown.
    // A real leave has a relatedTarget outside the host.
    const related = e.relatedTarget as Node | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      if (related && timerRef.current) clear()
    }
  }, [clear])

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (!enabled) return
      if (nestedInteractive(e.target, e.currentTarget)) return
      if (firedRef.current) return
      firedRef.current = true
      suppressClickRef.current = true
      clear()
      onLongPressRef.current()
    },
    [clear, enabled],
  )

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current && !firedRef.current) return
    e.preventDefault()
    e.stopPropagation()
    suppressClickRef.current = false
    firedRef.current = false
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onContextMenu, onClickCapture }
}
