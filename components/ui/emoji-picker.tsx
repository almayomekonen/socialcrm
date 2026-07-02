'use client'

import dynamic from 'next/dynamic'
import { memo, useEffect, useRef, type RefObject } from 'react'
import type { EmojiStyle } from 'emoji-picker-react'

/**
 * Floating emoji picker popover, anchored above its (position: relative) parent.
 * The heavy emoji-picker-react bundle is a separate chunk that starts loading
 * only on the first open (the component renders null until then), and stays
 * mounted afterwards so re-opens are instant.
 */
const Picker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => (
    <div className='flex h-[360px] w-full items-center justify-center text-sm text-gray-400'>טוען אימוג׳ים…</div>
  ),
})

function EmojiPicker({
  open,
  onClose,
  onPick,
  triggerRef,
}: {
  open: boolean
  /** reason: 'escape' closes via keyboard, 'outside' via click-away. Selection closes via onPick. */
  onClose: (reason: 'escape' | 'outside') => void
  onPick: (emoji: string) => void
  triggerRef: RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const openedOnceRef = useRef(false)
  if (open) openedOnceRef.current = true

  // Latest-ref so the document listeners bind once per open, not once per
  // parent render (the composer re-renders on every keystroke).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current('escape')
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      onCloseRef.current('outside')
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, triggerRef])

  if (!openedOnceRef.current && !open) return null

  return (
    <div
      ref={panelRef}
      role='dialog'
      aria-label='בחירת אימוג׳י'
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      className={`absolute bottom-full start-0 z-50 mb-2 w-80 max-w-[75vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl transition duration-150 ease-out focus:outline-none ${
        open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
      }`}
    >
      <Picker
        onEmojiClick={(d) => onPick(d.emoji)}
        emojiStyle={'native' as EmojiStyle}
        width='100%'
        height={360}
        searchPlaceHolder='חיפוש אימוג׳י'
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        lazyLoadEmojis
      />
    </div>
  )
}

// Memoized: with stable handler props the picker subtree skips the composer's
// per-keystroke re-renders entirely.
export default memo(EmojiPicker)
