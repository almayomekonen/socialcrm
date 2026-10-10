'use client'

import { useCallback, useEffect, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useKeepOpenBoxInView } from './keepOpenBoxInView'
import type { Point, Size } from './flowLayout'
import { ADD_QUESTION } from './removalFocus'

/**
 * Where the map looks and where the cursor goes, for FlowCanvas (moved here
 * unchanged from it): the first view, a box opened for editing kept on screen,
 * a new box brought into view with the cursor in its question, and after a
 * deletion the cursor on a surviving control.
 */
export function useCanvasViewport({
  ids,
  sizes,
  layout,
  selectedKey,
}: {
  ids: string[]
  sizes: Record<string, Size>
  layout: Record<string, Point>
  selectedKey: string | null
}) {
  const flow = useReactFlow()
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  // A box just created opens with the cursor in its question text.
  const [focusRequest, setFocusRequest] = useState<string | null>(null)
  // After a deletion: the box (or "+ הוספת שאלה") that takes the cursor instead.
  const [returnFocus, setReturnFocus] = useState<string | null>(null)
  const [fitted, setFitted] = useState(false)

  // First view: everything fits once the boxes have been measured.
  const allMeasured = ids.every((id) => sizes[id])
  useEffect(() => {
    if (allMeasured && !fitted) {
      setFitted(true)
      // Start where the conversation starts, at a size that can be read; never
      // shrink a long questionnaire into an unreadable overview.
      const bounds = flow.getNodesBounds(ids)
      const box = document.querySelector('.react-flow')?.getBoundingClientRect()
      const zoom = box ? Math.max(0.75, Math.min(1, (box.width - 48) / bounds.width)) : 1
      const x = box ? (box.width - bounds.width * zoom) / 2 - bounds.x * zoom : 0
      void flow.setViewport({ x, y: 24 - bounds.y * zoom, zoom })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeasured, fitted, flow])

  // A box opened for editing stays on screen (a just-created box is revealed by the effect after this).
  useKeepOpenBoxInView(selectedKey, pendingReveal, (id) => (layout[id] && sizes[id] ? { ...layout[id], ...sizes[id] } : null))

  // A box just created is brought into view once it exists and is measured.
  useEffect(() => {
    if (!pendingReveal || !sizes[pendingReveal]) return
    void flow.fitView({ nodes: [{ id: pendingReveal }], maxZoom: 1, duration: 300, padding: 0.4 })
    setPendingReveal(null)
  }, [pendingReveal, sizes, flow])

  // The confirmation dialog hands the cursor back to the deleted box's ×,
  // which no longer exists; once the map has re-rendered, it goes to the
  // chosen surviving control instead (a few frames: the box may be re-measured).
  useEffect(() => {
    if (!returnFocus) return
    let frames = 0
    let handle = 0
    const find = () =>
      returnFocus === ADD_QUESTION
        ? document.querySelector<HTMLElement>('.react-flow button[aria-haspopup="menu"]')
        : [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
            .find((n) => n.getAttribute('data-id') === returnFocus)
            ?.querySelector<HTMLElement>('button[aria-label^="עריכת"]')
    const attempt = () => {
      const el = find()
      el?.focus({ preventScroll: true })
      if (el && document.activeElement === el) return setReturnFocus(null)
      if (++frames < 30) handle = requestAnimationFrame(attempt)
      else setReturnFocus(null)
    }
    handle = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(handle)
  }, [returnFocus])

  const reveal = useCallback((nodeId: string) => {
    setPendingReveal(nodeId)
    setFocusRequest(nodeId)
  }, [])
  return {
    reveal,
    focusRequest,
    focusDone: () => setFocusRequest(null),
    returnFocusTo: (nodeId: string) => {
      if (nodeId !== ADD_QUESTION) setPendingReveal(nodeId)
      setReturnFocus(nodeId)
    },
  }
}
