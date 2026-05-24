'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Closes all open popovers when the user clicks outside the composer or
 * presses Escape. The single handler is only attached when at least one
 * popover is open to keep idle event-listener noise low.
 */
export function useOutsidePopoverClose({
  composerRef,
  anyOpen,
  closeAll,
}: {
  composerRef: RefObject<HTMLDivElement | null>
  anyOpen: boolean
  closeAll: () => void
}) {
  useEffect(() => {
    if (!anyOpen) return
    function onPointer(e: MouseEvent) {
      if (!composerRef.current?.contains(e.target as Node)) closeAll()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAll()
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [composerRef, anyOpen, closeAll])
}
