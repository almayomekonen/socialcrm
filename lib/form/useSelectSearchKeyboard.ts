'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Keyboard navigation for an autocomplete list.
 *
 * `SelectSearch` could only be operated with a mouse: its options answered
 * `onMouseDown` and the input answered no key at all. A rep working a list at
 * speed had to leave the keyboard to finish a search, and a keyboard-only user
 * could not finish one — `frontend-experience-guidelines.md` §19.
 *
 * Lives in its own file so the component stays inside the size budget, and so
 * the interaction rules are testable on their own. Holds no data of its own: the
 * result set and open/closed state stay owned by the component.
 *
 * `highlight === -1` means "nothing explicitly chosen"; Enter then commits the
 * top match, which is what an autocomplete is expected to do.
 */
export function useSelectSearchKeyboard<T>({
  data,
  isOpen,
  setIsOpen,
  onCommit,
}: {
  data: T[]
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  /**
   * Commit whatever Enter should commit. Receives the highlighted index, or -1
   * when the user has not explicitly chosen a row. Returns true if it handled
   * the key — the hook only calls `preventDefault` when it did, so a consumer
   * with nothing to commit leaves a host form's implicit submit intact.
   */
  onCommit: (highlightedIndex: number) => boolean
}) {
  const listboxId = useId()
  const [highlight, setHighlight] = useState(-1)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  // A new result set invalidates the index — it could otherwise point past the
  // end of the list, and Enter would commit `undefined`.
  useEffect(() => setHighlight(-1), [data])

  // The panel is `max-h-50 overflow-y-auto`, so arrowing past the fold has to
  // bring the option into view or the highlight silently disappears. Called
  // optionally: `scrollIntoView` is absent in jsdom, and a missing scroll must
  // never break the interaction it is only decorating.
  useEffect(() => {
    optionRefs.current[highlight]?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight])

  /**
   * `preventDefault` is called ONLY when this hook actually handles the key.
   *
   * `SelectSearch` sits inside real forms elsewhere (SaleForm, AddTaskForm, the
   * tasks filter bar), where Enter submits the form today and must keep doing
   * so. With no list open — or nothing for the consumer to commit — every key is
   * passed straight through. No form is introduced, and Enter causes no
   * navigation a mouse click would not have caused.
   */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      if (!isOpen) return
      e.preventDefault()
      setIsOpen(false)
      setHighlight(-1)
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (data.length === 0) return
      e.preventDefault()
      if (!isOpen) {
        // Reopen a list the user dismissed, without re-running the search.
        setIsOpen(true)
        setHighlight(e.key === 'ArrowDown' ? 0 : data.length - 1)
        return
      }
      setHighlight((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, data.length - 1) : Math.max(h - 1, 0)))
      return
    }

    if (e.key === 'Enter') {
      if (!isOpen) return
      if (!onCommit(highlight)) return
      e.preventDefault()
      setHighlight(-1)
    }
  }

  return { listboxId, highlight, setHighlight, optionRefs, onKeyDown }
}
