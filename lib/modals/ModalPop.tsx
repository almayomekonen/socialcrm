'use client'

import { JSX, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { twMerge } from 'tailwind-merge'
import Icon from '@/lib/Icon'

export default function ModalPop({ children, className, onClose, open, closeOutside = false, pos = 'top' }: Props): JSX.Element {
  // Portals require `document`, so wait for client-side mount before rendering.
  // Without the gate, SSR would crash on `document.body` and hydration would
  // mismatch on the empty fragment.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!open || !mounted) return null

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
      className={`flex  justify-center fixed top-0 left-0 size-full bg-black/15 z-99999 anim-fade-in ${
        pos === 'middle' ? 'items-center' : 'items-start'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={twMerge(
          'max-h-[90vh] overflow-y-auto bg-white p-8  shadow-2xl relative popin overflow-x-hidden scrollbar-slim',
          pos === 'middle' ? 'rounded-lg' : 'rounded-b-lg',
          className
        )}
      >
        <button className='absolute top-2 left-2' title='יציאה ללא שמירה' onClick={onClose}>
          <Icon name='circle-xmark' className='size-[22px] bg-red-700' />
        </button>

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
  pos?: 'top' | 'middle'
}
