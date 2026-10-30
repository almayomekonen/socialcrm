'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The template card's row menu: open state, the two refs, and the outside
 * press / Escape handling.
 *
 * Extracted from TemplateCard, which had crossed the file-size soft limit
 * (architecture-rules §1: the touch is the trigger). Unchanged behaviour.
 */
export function useCardMenu() {
  /*
    Anchored to the card rather than to the viewport.

    The shared floating-menu hook places against the viewport using the
    Follow-Up menu's dimensions — 224px wide and a 248px height estimate — so a
    one-item menu got flipped and clamped, and landed nowhere near the button
    that opened it. A menu positioned inside the card cannot drift: it is laid
    out against the trigger and travels with the card.
  */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      // Escape hands the focus back, or the keyboard user is left nowhere.
      triggerRef.current?.focus()
    }
    // Pressing another card's trigger is an outside press here, so opening one
    // menu closes any other: only one is ever open.
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return { menuOpen, setMenuOpen, menuRef, triggerRef }
}
