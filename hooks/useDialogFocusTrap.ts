import { useEffect, type RefObject } from 'react'

/**
 * Initial focus and a Tab cycle for a NON-DISMISSIBLE dialog.
 *
 * Extracted from WelcomeTrialModal when that file was simplified: it is
 * presentation plumbing, not welcome-screen logic, and keeping it inline was
 * most of what held the component over the file-size soft limit
 * (architecture-rules.md §1, §3).
 *
 * ModalPop owns no trap of its own and mounts its portal one effect-tick after
 * `open` flips, so the first focus retries on animation frames until the dialog
 * exists in the DOM rather than assuming it is already there.
 *
 * Deliberately NOT applied to the other dialogs that roll their own trap
 * (BottomSheet, WhatsappImageViewer, HoverTooltip). Unifying them is a separate
 * change with its own risk, and this extraction is not the place to make it.
 */
export function useDialogFocusTrap(open: boolean, dialogRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    let raf = 0

    const focusables = () => {
      const dialog = dialogRef.current
      if (!dialog) return []
      return Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"))
    }

    const tryInitialFocus = () => {
      const els = focusables()
      if (els.length > 0) els[0].focus()
      else raf = requestAnimationFrame(tryInitialFocus)
    }
    tryInitialFocus()

    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      const els = focusables()
      if (!dialog || els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeydown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeydown)
    }
  }, [open, dialogRef])
}
