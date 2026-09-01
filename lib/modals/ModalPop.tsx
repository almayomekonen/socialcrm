'use client'

import { JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { twMerge } from 'tailwind-merge'
import Icon from '@/lib/Icon'

// Elements that can receive keyboard focus inside the dialog. Used for the focus
// trap and for moving focus in on open.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

export default function ModalPop({
  children,
  className,
  onClose,
  open,
  closeOutside = false,
  pos = 'top',
  hideClose = false,
  label,
  labelledBy,
  describedBy,
  scrimClassName,
}: Props): JSX.Element {
  // Portals require `document`, so wait for client-side mount before rendering.
  // Without the gate, SSR would crash on `document.body` and hydration would
  // mismatch on the empty fragment.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const contentRef = useRef<HTMLDivElement>(null)
  // The element that had focus when the dialog opened, so we can restore it on
  // close — keyboard/screen-reader users return to where they were.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // Dev-only guardrail: the generic fallback name is a defensive safety net, not
  // the intended solution. Every production dialog should pass a meaningful name.
  // Warn (never throw, never in production) so new dialogs don't ship nameless.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    if (open && !label && !labelledBy) {
      console.warn(
        '[ModalPop] Dialog is falling back to a generic accessible name. ' +
          'Pass `labelledBy` (preferred — point it at a visible heading id) or `label` ' +
          'so screen-reader users hear what this dialog is.',
      )
    }
  }, [open, label, labelledBy])

  /**
   * Body scroll lock — BOTTOM SHEETS ONLY, deliberately.
   *
   * Without it a sheet on a phone scrolls the page behind it ("scroll chaining"),
   * which reads as the sheet drifting. Scoped to `pos='bottom'` rather than applied
   * to every dialog because top/middle dialogs are the existing desktop modals, and
   * silently locking the body under them would be a behaviour change to surfaces
   * this phase is not allowed to touch.
   *
   * Restores the PREVIOUS inline value rather than clearing it, so a sheet opened
   * over another lock (nested sheet) cannot unlock the page on its own close.
   */
  useEffect(() => {
    if (!open || !mounted || pos !== 'bottom') return
    const body = document.body
    const previous = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = previous
    }
  }, [open, mounted, pos])

  // Move focus into the dialog on open; restore it to the trigger on close.
  // Container-scoped (not document-wide) so nested dialogs each manage their own
  // focus without fighting each other.
  useEffect(() => {
    if (!open || !mounted) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    // Focus the dialog container itself (tabIndex=-1): announces the dialog to
    // screen readers and leaves the first Tab to land on the first control —
    // no surprise focus ring on the close button, no visual flicker. Skip if a
    // child already took focus (e.g. an autoFocus input) so we don't override it.
    const node = contentRef.current
    if (node && !node.contains(document.activeElement)) node.focus()
    return () => {
      const el = restoreFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open, mounted])

  if (!open || !mounted) return null

  // Escape closes; Tab/Shift+Tab are trapped within the dialog. Bound to the
  // content element, so for nested dialogs the event only reaches the dialog
  // that currently holds focus.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const node = contentRef.current
    if (!node) return
    const focusables = getFocusable(node)
    if (focusables.length === 0) {
      e.preventDefault()
      node.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || active === node) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Render at <body> root via portal. This is the standard React pattern for
  // modals and guarantees `position: fixed` resolves to the viewport — no
  // matter what containing-block-creating property (transform, filter,
  // backdrop-filter, will-change, contain, perspective) any ancestor might
  // have. Without the portal, a sticky/fixed sibling with backdrop-blur, a
  // transitioning grid track, or any other future layout property on a
  // parent could pin the overlay to a sub-region of the viewport and clip
  // the modal — which is exactly what was happening on the draft editor.
  return createPortal(
    <div
      onClick={closeOutside ? onClose : null}
      className={`flex  justify-center fixed top-0 left-0 size-full ${scrimClassName ?? 'bg-black/15'} z-99999 anim-fade-in ${
        pos === 'middle' ? 'items-center' : pos === 'bottom' ? 'items-end' : 'items-start'
      }`}
    >
      <div
        ref={contentRef}
        role='dialog'
        aria-modal='true'
        aria-label={labelledBy ? undefined : (label ?? 'תיבת דו-שיח')}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={twMerge(
          'overflow-y-auto bg-white shadow-2xl relative popin overflow-x-hidden scrollbar-slim outline-none',
          // Padding is applied as ONE class per variant rather than layering
          // `px-*`/`pb-*` over a base `p-8`: Tailwind resolves same-specificity
          // conflicts by stylesheet order, not class-attribute order, so layering
          // would make the result depend on which utility Tailwind happened to
          // emit first. One class per variant is order-independent.
          pos === 'bottom'
            ? // Safe-area aware: on a notched phone the home indicator sits over
              // the last ~34px, which is exactly where a sheet's primary action
              // lands. env() falls back to 0px on devices without insets.
              'p-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]'
            : 'p-8',
          pos === 'bottom'
            ? // dvh (not vh) so the sheet is not clipped behind mobile browser
              // chrome; anim-slide-down enters from translateY(100%) → 0, i.e.
              // rises from the bottom edge. Motion is opt-out per §18.
              'w-full max-w-[640px] max-h-[85dvh] rounded-t-2xl anim-slide-down motion-reduce:animation-none'
            : 'max-h-[90vh]',
          pos === 'middle' ? 'rounded-lg' : pos === 'bottom' ? '' : 'rounded-b-lg',
          className
        )}
      >
        {!hideClose && (
          <button className='absolute top-2 left-2' title='יציאה ללא שמירה' aria-label='סגירה' onClick={onClose}>
            <Icon name='circle-xmark' className='size-[22px] bg-red-700' />
          </button>
        )}

        {children}
      </div>
    </div>,
    document.body,
  )
}

type Props = {
  children: React.ReactNode
  closeUrl?: string
  className?: string
  onClose: () => void
  open: boolean
  closeOutside?: boolean
  /**
   * 'top' / 'middle' are the existing desktop dialog placements and are unchanged.
   * 'bottom' is the mobile bottom sheet: full-width, top-rounded, safe-area padded,
   * slide-up entrance, and body-scroll-locked while open. Prefer the `BottomSheet`
   * wrapper (components/mobile/BottomSheet.tsx) over passing this directly.
   */
  pos?: 'top' | 'middle' | 'bottom'
  hideClose?: boolean
  // Accessible name. Provide `label` for a plain string, or `labelledBy` to point
  // at the id of a visible heading inside the dialog (preferred when one exists).
  label?: string
  labelledBy?: string
  // id of an element describing the dialog, exposed via aria-describedby.
  describedBy?: string
  /**
   * Scrim override. Defaults to the existing `bg-black/15` so every current
   * dialog is untouched; the image viewer darkens it so a photo is judged
   * against neutral surroundings rather than the page bleeding through.
   */
  scrimClassName?: string
}
