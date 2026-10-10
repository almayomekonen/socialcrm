'use client'

import { useState, type ReactNode, type RefObject } from 'react'
import type { NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import QuestionKindMenu from './QuestionKindMenu'

const MENU_WIDTH = 256
const MENU_HEIGHT = 200
const GAP = 6
const EDGE = 8

/**
 * The question menu for "+" on an arrow. It is drawn in the canvas (not in
 * the zoomed map layer, so it is always full size), centred under the "+",
 * above it when there is no room below, and kept inside the canvas on every
 * side so nothing of it is ever clipped. Choosing a type calls `onPick` once;
 * Escape gives focus back to the "+"; a click elsewhere just closes it.
 */
export function useArrowInsert(
  canvas: RefObject<HTMLDivElement | null>,
  onPick: (edgeId: string, kind: NewQuestionKind) => void,
): { openEdge: string | null; openFor: (edgeId: string, button: HTMLButtonElement) => void; close: () => void; menu: ReactNode } {
  const [at, setAt] = useState<{ edgeId: string; button: HTMLButtonElement; left: number; top: number } | null>(null)

  const openFor = (edgeId: string, button: HTMLButtonElement) => {
    if (at?.edgeId === edgeId) return setAt(null)
    const box = canvas.current?.getBoundingClientRect()
    const b = button.getBoundingClientRect()
    if (!box) return
    const clamp = (v: number, max: number) => Math.max(EDGE, Math.min(v, max - EDGE))
    const left = clamp(b.left - box.left + b.width / 2 - MENU_WIDTH / 2, box.width - MENU_WIDTH)
    const below = b.bottom - box.top + GAP
    const top = below + MENU_HEIGHT <= box.height - EDGE ? below : clamp(b.top - box.top - GAP - MENU_HEIGHT, box.height - MENU_HEIGHT)
    setAt({ edgeId, button, left, top })
  }

  const menu = at && (
    <QuestionKindMenu
      className='absolute'
      style={{ left: at.left, top: at.top }}
      isInside={(t) => at.button.contains(t)}
      onPick={(kind) => {
        setAt(null)
        onPick(at.edgeId, kind)
      }}
      onClose={(returnFocus) => {
        setAt(null)
        if (returnFocus) at.button.focus()
      }}
    />
  )
  return { openEdge: at?.edgeId ?? null, openFor, close: () => setAt(null), menu }
}
