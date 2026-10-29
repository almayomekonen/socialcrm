'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placeFollowUpMenu } from '@/lib/leads/placeFollowUpMenu'
import type { RegionAttrs } from '@/lib/i18n/config'

/**
 * Small clip-safe hover/focus tooltip.
 *
 * Renders its panel through a body portal at `position: fixed` (zIndex 100000),
 * so it ESCAPES the Inbox scroll/overflow containers that clip inline tooltips —
 * the same createPortal recipe the floating menus use (OutcomeControl et al.).
 * Positioning reuses the pure, unit-tested `placeFollowUpMenu` (RTL right-edge
 * anchor + viewport top/bottom flip + clamp), so it is never clipped by the
 * viewport either.
 *
 * Interaction: hover opens after a short delay (~120ms); keyboard focus opens
 * immediately; mouse-leave, blur, Escape, and any scroll/resize close it. The
 * panel is pointer-events:none (not interactive), so there is no bridge/hover-gap
 * problem and no focus trap.
 *
 * Accessibility: the trigger carries a real accessible NAME via `label` (sr-only)
 * that stays meaningful when the panel is closed and does not depend on hover, so
 * assistive tech and touch users are never left with the visual panel alone. The
 * panel mirrors that copy for sighted users (role='tooltip'); it is not referenced
 * by aria-describedby, so it is not double-announced.
 */
const SHOW_DELAY_MS = 120
const TOOLTIP_WIDTH = 288
const TOOLTIP_EST_HEIGHT = 132

type Props = {
  /** The visible trigger (e.g. an icon). */
  children: ReactNode
  /** The tooltip panel content (visible to sighted users). */
  content: ReactNode
  /** Accessible name for the trigger — meaningful even when the tooltip is closed. */
  label: string
  /** Class for the focusable trigger wrapper (include a visible focus style). */
  className?: string
  /**
   * Optional panel styling. Defaults to the neutral white card this component
   * has always drawn; supplied only when a caller needs the panel to speak a
   * different established language, such as the warm subscription tokens.
   */
  panelClassName?: string
  /**
   * `lang`/`dir` of a TRANSLATED caller (`useRegionAttrs()`), for the portalled
   * panel. Omitted: the panel stays Hebrew right-to-left, exactly as before.
   */
  region?: RegionAttrs
}

export function HoverTooltip({ children, content, label, className, panelClassName, region }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tipId = useId()

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function openNow() {
    clearTimer()
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(
      placeFollowUpMenu(
        { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        { width: window.innerWidth, height: window.innerHeight },
        { width: TOOLTIP_WIDTH, estHeight: TOOLTIP_EST_HEIGHT, gap: 6 },
      ),
    )
    setOpen(true)
  }

  function openDelayed() {
    clearTimer()
    timerRef.current = setTimeout(openNow, SHOW_DELAY_MS)
  }

  function close() {
    clearTimer()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onMove = () => close()
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  // Never leave a pending open timer behind on unmount.
  useEffect(() => () => clearTimer(), [])

  return (
    <span
      ref={wrapRef}
      className={className}
      onMouseEnter={openDelayed}
      onMouseLeave={close}
      onFocus={openNow}
      onBlur={close}
      tabIndex={0}
    >
      <span className='sr-only'>{label}</span>
      {children}
      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={tipId}
              role='tooltip'
              dir={region?.dir ?? 'rtl'}
              lang={region?.lang}
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 100000 }}
              className={
                panelClassName ??
                'pointer-events-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
              }
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
