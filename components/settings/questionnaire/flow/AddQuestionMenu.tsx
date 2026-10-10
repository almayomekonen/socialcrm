'use client'

import { useEffect, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import type { NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'

const KINDS: Array<{ kind: NewQuestionKind; label: string; hint: string }> = [
  { kind: 'single_choice', label: 'בחירה של תשובה אחת', hint: 'הלקוח בוחר אחת מהרשימה' },
  { kind: 'multi_choice', label: 'בחירה של כמה תשובות', hint: 'הלקוח יכול לבחור כמה' },
  { kind: 'text', label: 'תשובה חופשית', hint: 'הלקוח כותב במילים שלו' },
]

/**
 * "+ הוספת שאלה לפני הסיום" (or, on an empty questionnaire, "הוספת השאלה
 * הראשונה"): pick how the customer answers; the question is added last and
 * connected. One menu, one way to add a question.
 *
 * The menu opens toward the inside of the canvas, which clips anything past
 * its edge: below the button, from its right edge (inline start in RTL) when
 * the button sits top-right; above it, centred, when it sits bottom-centre.
 */
export default function AddQuestionMenu({
  onAdd,
  disabledReason,
  label = 'הוספת שאלה לפני הסיום',
  opens = 'below',
}: {
  onAdd: (kind: NewQuestionKind) => void
  disabledReason: string | null
  label?: string
  opens?: 'below' | 'above'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Opened from the keyboard or the mouse, the first choice takes focus.
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return
        // Dismissed from the keyboard: back to the button that opened the menu.
        setOpen(false)
        ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus()
      } else if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    // Capture phase: the map's pan handler stops mousedown from bubbling, so a
    // click on the empty map would otherwise leave the menu open.
    document.addEventListener('mousedown', close, true)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={ref} className='relative' dir='rtl'>
      <Btn
        type='button'
        icon='plus'
        lbl={label}
        aria-expanded={open}
        aria-haspopup='menu'
        aria-disabled={disabledReason ? true : undefined}
        onClick={() => !disabledReason && setOpen((o) => !o)}
      />
      {disabledReason && <span className='sr-only'>{disabledReason}</span>}
      {open && (
        <div
          role='menu'
          aria-label='איך הלקוח יענה?'
          className={`absolute z-10 grid w-64 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg ${
            opens === 'above' ? 'bottom-12 start-1/2 translate-x-1/2' : 'start-0 top-12'
          }`}
        >
          <p className='px-2 pb-1 text-xs text-gray-500'>איך הלקוח יענה?</p>
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type='button'
              role='menuitem'
              onClick={() => {
                setOpen(false)
                onAdd(k.kind)
              }}
              className='grid rounded-md px-2 py-1.5 text-start hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary'
            >
              <span className='text-sm font-medium text-ink'>{k.label}</span>
              <span className='text-xs text-gray-500'>{k.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
