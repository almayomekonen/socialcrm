'use client'

import type { ReactNode } from 'react'
import ModalPop from '@/lib/modals/ModalPop'

/**
 * The mobile bottom sheet — filters, action menus, quick pickers.
 *
 * A THIN WRAPPER over `ModalPop`, never a second dialog system
 * (`ux-guidelines.md` §12, `architecture-rules.md` §10). ModalPop already owns
 * the portal, the focus trap, Escape-to-close, focus restore, and the accessible
 * name; `pos='bottom'` adds the sheet placement, safe-area padding, slide-up
 * entrance and body-scroll lock. Everything a sheet needs was already there.
 *
 * Why a wrapper at all rather than passing `pos='bottom'` directly: the grab
 * handle and the title row are sheet conventions a phone user reads as
 * "draggable, dismissible surface", and repeating that markup at every call
 * site is how two sheets end up looking different.
 *
 * Dismissal: tapping the scrim closes by default (`closeOutside`), which is the
 * platform expectation for a sheet — unlike the desktop dialogs, where an
 * accidental outside click can discard a half-typed form.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  titleId = 'bottom-sheet-title',
  children,
  className = '',
  dismissOnScrim = true,
}: {
  open: boolean
  onClose: () => void
  /** Visible heading. Also becomes the dialog's accessible name via `labelledBy`. */
  title: string
  titleId?: string
  children: ReactNode
  className?: string
  dismissOnScrim?: boolean
}) {
  return (
    <ModalPop
      open={open}
      onClose={onClose}
      pos='bottom'
      closeOutside={dismissOnScrim}
      labelledBy={titleId}
      hideClose
      className={className}
    >
      {/* Grab handle. Purely affordance — `aria-hidden` because it is not
          operable; dismissal is the scrim, Escape, or the close button. */}
      <div aria-hidden='true' className='mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300' />

      <div className='mb-4 flex items-center justify-between gap-3'>
        <h2 id={titleId} className='text-lg font-bold text-ink'>
          {title}
        </h2>
        {/* 44px touch target (size-11), not the 22px desktop glyph. */}
        <button
          type='button'
          onClick={onClose}
          aria-label='סגירה'
          className='-me-1 flex size-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <span aria-hidden='true' className='text-2xl leading-none'>
            ×
          </span>
        </button>
      </div>

      {children}
    </ModalPop>
  )
}
