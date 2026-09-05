'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { CloseIcon } from './promptIcons'

/**
 * Image attachments on the composer — the strip that slides out from behind the
 * input, and the shared-element preview it opens into.
 *
 * ENTIRELY LOCAL. Files never leave the browser: each one becomes an
 * `URL.createObjectURL` blob for the thumbnail and is revoked on removal. No
 * upload endpoint is called and none exists yet, so nothing here implies the
 * agent can read the file — it is the picker and the preview, working, with the
 * transport still to come.
 */

export type Attachment = {
  id: string
  file: File
  url: string
  name: string
  width: number
  height: number
}

export function AttachmentThumb({
  attachment,
  index,
  onRemove,
  onOpen,
}: {
  attachment: Attachment
  index: number
  onRemove: (id: string) => void
  onOpen: (attachment: Attachment, rect: DOMRect) => void
}) {
  const [hovered, setHovered] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <button
      ref={btnRef}
      type='button'
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation()
        if (btnRef.current) onOpen(attachment, btnRef.current.getBoundingClientRect())
      }}
      style={{ animationDelay: `${index * 35}ms`, animationFillMode: 'backwards' }}
      className={cn(
        'group relative size-12 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-white/10 outline-none',
        'transition-transform duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:scale-[1.04] active:scale-[0.96]',
        'focus-visible:ring-2 focus-visible:ring-white/60',
        'animate-in fade-in zoom-in-90 slide-in-from-top-3 duration-300 motion-reduce:animate-none',
      )}
      aria-label={`תצוגה מקדימה של ${attachment.name}`}
    >
      <img src={attachment.url} alt='' className='size-full object-cover' draggable={false} />
      <span className={cn('absolute inset-0 flex items-start justify-end transition-colors duration-200', hovered && 'bg-black/25')}>
        <span
          role='button'
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onRemove(attachment.id)
          }}
          className={cn(
            'm-1 flex size-4 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm',
            'transition-all duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-white hover:scale-110',
            hovered ? 'scale-100 opacity-100' : 'pointer-events-none scale-50 opacity-0',
          )}
          aria-label={`הסרת ${attachment.name}`}
        >
          <CloseIcon />
        </span>
      </span>
    </button>
  )
}

/**
 * FLIP preview: the thumbnail's own rect is the opening geometry, so the image
 * appears to grow out of the strip rather than cross-fading in over it.
 */
export function AttachmentPreview({
  attachment,
  originRect,
  onClose,
}: {
  attachment: Attachment
  originRect: DOMRect
  onClose: () => void
}) {
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>('opening')
  const [target, setTarget] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const maxW = Math.min(window.innerWidth * 0.86, 560)
    const maxH = Math.min(window.innerHeight * 0.78, 720)
    const scale = Math.min(maxW / attachment.width, maxH / attachment.height, 1.6)
    const width = attachment.width * scale
    const height = attachment.height * scale
    setTarget({ top: (window.innerHeight - height) / 2, left: (window.innerWidth - width) / 2, width, height })
    const raf = requestAnimationFrame(() => setPhase('open'))
    return () => cancelAnimationFrame(raf)
  }, [attachment])

  const close = useCallback(() => setPhase('closing'), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const isOpen = phase === 'open'
  const geometry =
    isOpen && target
      ? { ...target, radius: 20 }
      : { top: originRect.top, left: originRect.left, width: originRect.width, height: originRect.height, radius: 12 }

  const dur = phase === 'closing' ? '0.3s' : '0.45s'
  const easing = phase === 'closing' ? 'ease-out' : 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'

  return (
    <div className='fixed inset-0 z-9999' onClick={close} role='dialog' aria-modal='true' aria-label={attachment.name}>
      <div className='absolute inset-0 bg-ink/70 backdrop-blur-md transition-opacity duration-300' style={{ opacity: isOpen ? 1 : 0 }} />
      <div
        style={{
          position: 'fixed',
          top: geometry.top,
          left: geometry.left,
          width: geometry.width,
          height: geometry.height,
          borderRadius: geometry.radius,
          overflow: 'hidden',
          transition: `top ${dur} ${easing}, left ${dur} ${easing}, width ${dur} ${easing}, height ${dur} ${easing}, border-radius ${dur} ${easing}`,
          boxShadow: isOpen ? '0 24px 60px -12px rgb(0 0 0 / 0.35)' : 'none',
        }}
        onTransitionEnd={() => {
          if (phase === 'closing') onClose()
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={attachment.url} alt={attachment.name} className='size-full object-cover' draggable={false} />
      </div>

      <button
        type='button'
        onClick={close}
        style={{ opacity: isOpen ? 1 : 0, transform: isOpen ? 'scale(1)' : 'scale(0.7)' }}
        className={cn(
          'fixed end-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md backdrop-blur-sm',
          'transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-white',
          !isOpen && 'pointer-events-none',
        )}
        aria-label='סגירה'
      >
        <span className='scale-150'>
          <CloseIcon />
        </span>
      </button>
    </div>
  )
}
