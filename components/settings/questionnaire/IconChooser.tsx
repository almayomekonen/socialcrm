'use client'

import { useEffect, useId, useRef, useState } from 'react'
import EmojiPicker from '@/components/ui/emoji-picker'

/** Icons businesses on WhatsApp actually use for menu answers; anything else via "עוד אייקונים". */
const COMMON = ['💄', '💇', '✨', '💍', '🎉', '👶', '📸', '🎥', '🚁', '💼', '🏠', '📅', '📍', '✅', '❌', '🤷', '💬', '⭐']

/**
 * The optional icon shown after an answer in WhatsApp ("1. איפור 💄").
 *
 * Not a bare text box: the answer shows its icon (or a quiet "+ אייקון"), and
 * clicking it opens a small palette of common icons with "ללא אייקון". The
 * full emoji catalogue the inbox already uses is one click further.
 */
export default function IconChooser({
  icon,
  answerName,
  onChange,
}: {
  icon: string | undefined
  /** For names read aloud: "אייקון לתשובה איפור". */
  answerName: string
  onChange: (icon: string | undefined) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const choose = (next: string | undefined) => {
    onChange(next)
    setOpen(false)
    setMore(false)
    trigger.current?.focus()
  }

  return (
    <div ref={wrap} className='nodrag relative shrink-0'>
      <button
        ref={trigger}
        type='button'
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-controls={open ? `${id}-palette` : undefined}
        aria-label={icon ? `אייקון לתשובה ${answerName}: ${icon}. שינוי` : `הוספת אייקון לתשובה ${answerName}`}
        onClick={() => setOpen((o) => !o)}
        className={
          icon
            ? 'flex size-8 items-center justify-center rounded-md text-base hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary'
            : 'flex h-8 items-center rounded-md px-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-2 focus-visible:outline-primary'
        }
      >
        {icon ?? '+ אייקון'}
      </button>
      {open && (
        <div
          id={`${id}-palette`}
          role='dialog'
          aria-label={`אייקון לתשובה ${answerName}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
              trigger.current?.focus()
            }
          }}
          className='absolute end-0 top-9 z-20 grid w-56 gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-lg'
        >
          <p className='text-xs text-gray-500'>האייקון מופיע אחרי התשובה בוואטסאפ. לא חובה.</p>
          <div className='grid grid-cols-6 gap-1'>
            {COMMON.map((e) => (
              <button
                key={e}
                type='button'
                aria-label={`בחירת האייקון ${e}`}
                aria-pressed={icon === e}
                onClick={() => choose(e)}
                className='flex size-8 items-center justify-center rounded text-base hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-indigo-50'
              >
                {e}
              </button>
            ))}
          </div>
          <div className='flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs'>
            <button type='button' onClick={() => choose(undefined)} className='text-gray-600 underline underline-offset-2'>
              ללא אייקון
            </button>
            <div className='relative'>
              <button type='button' onClick={() => setMore(true)} className='text-gray-600 underline underline-offset-2'>
                עוד אייקונים…
              </button>
              <EmojiPicker open={more} onClose={() => setMore(false)} onPick={(e) => choose(e)} triggerRef={trigger} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
