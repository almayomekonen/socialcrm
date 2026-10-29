'use client'

import ModalPop from '@/lib/modals/ModalPop'

/**
 * Full-size viewer for one inbound WhatsApp photo.
 *
 * A THIN WRAPPER over `ModalPop`, never a second dialog system
 * (`ux-guidelines.md` §12). ModalPop already owns the portal, the focus trap,
 * Escape-to-close, focus restore to the thumbnail that opened it, the scrim and
 * the labelled close button — everything an image viewer needs was already here.
 *
 * The picture loads from the SAME authenticated media route as the thumbnail.
 * Opening it in a dialog rather than following a link is also what stops the
 * click from downloading: the route still says `Content-Disposition: attachment`,
 * which only governs navigation, and an `<img>` never navigates. No route change,
 * no public URL, no weakened auth.
 */
export default function WhatsappImageViewer({
  open,
  onClose,
  src,
  alt,
  label,
  translated = false,
}: {
  open: boolean
  onClose: () => void
  src: string
  alt: string
  /** The dialog's accessible name, in the caller's language. */
  label: string
  /** See ModalPop `translated`: the caller's screen follows the interface language. */
  translated?: boolean
}) {
  return (
    <ModalPop
      open={open}
      onClose={onClose}
      pos='middle'
      closeOutside
      label={label}
      translated={translated}
      scrimClassName='bg-black/80'
      className='max-h-[92vh] max-w-[92vw] bg-transparent p-0 shadow-none'
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; the optimizer cannot send the viewer's cookie */}
      <img
        src={src}
        alt={alt}
        className='block max-h-[88vh] max-w-[92vw] rounded-lg object-contain'
      />
    </ModalPop>
  )
}
