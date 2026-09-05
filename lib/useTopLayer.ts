'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Top-layer promotion for portal-rendered popovers.
 *
 * A panel portaled to <body> is still painted in the ORDINARY stacking order,
 * and ModalPop's scrim now lives in the browser's TOP LAYER (see the promotion
 * effect in `lib/modals/ModalPop.tsx`). The top layer paints above every
 * ordinary stacking context regardless of z-index, so a popover opened from
 * inside a dialog cannot be raised above that dialog by ANY number — it has to
 * join the layer. Show order decides there, and a popover opened from a dialog
 * is always shown after it.
 *
 * `manual`, never `auto`: an auto popover light-dismisses and forces every other
 * auto popover closed, which would tear down the dialog it was opened from.
 * Callers already own their own outside-click and Escape handling.
 *
 * Deliberately two hooks. Support is detected by the long-lived TRIGGER, so the
 * panel can carry `popover` on its very first render instead of flashing one
 * frame in the ordinary layer; the promotion itself belongs to the PANEL, which
 * mounts only while it is open.
 */

/** Whether this engine has a top layer. Measured on the client, never assumed. */
export function useCanTopLayer(): boolean {
  const [canTopLayer, setCanTopLayer] = useState(false)
  useEffect(() => {
    setCanTopLayer(typeof document.createElement('div').showPopover === 'function')
  }, [])
  return canTopLayer
}

/**
 * Holds `ref` in the top layer for as long as the calling component is mounted.
 * A no-op when `enabled` is false, so an engine without the Popover API keeps
 * the previous z-index behaviour exactly as it was.
 */
export function useTopLayerPromotion(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el || typeof el.showPopover !== 'function') return
    try {
      el.showPopover()
    } catch {
      // Already shown, or the node left the document first — nothing to undo.
    }
    return () => {
      try {
        el.hidePopover?.()
      } catch {
        // The node was already detached; it left the top layer with it.
      }
    }
  }, [ref, enabled])
}
