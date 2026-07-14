'use client'

import { useEffect, useRef, useState } from 'react'
import { placeFollowUpMenu } from '@/lib/leads/placeFollowUpMenu'

export type MenuPos = { top: number; left: number; width: number }

export function useFloatingMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function openMenu() {
    const el = wrapRef.current
    if (!el) return
    setPos(placeFollowUpMenu(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    setOpen(true)
  }

  function close() {
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return { open, pos, wrapRef, menuRef, openMenu, close, toggle: () => (open ? close() : openMenu()) }
}
