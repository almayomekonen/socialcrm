'use client'

import { useEffect, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import type { NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'

const KINDS: Array<{ kind: NewQuestionKind; label: string; hint: string }> = [
  { kind: 'single_choice', label: 'בחירה של תשובה אחת', hint: 'הלקוח בוחר אחת מהרשימה' },
  { kind: 'multi_choice', label: 'בחירה של כמה תשובות', hint: 'הלקוח יכול לבחור כמה' },
  { kind: 'text', label: 'תשובה חופשית', hint: 'הלקוח כותב במילים שלו' },
]

/** "+ הוספת שאלה לפני הסיום": pick how the customer answers; the question is added last and connected. */
export default function AddQuestionMenu({ onAdd, disabledReason }: { onAdd: (kind: NewQuestionKind) => void; disabledReason: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Opened from the keyboard or the mouse, the first choice takes focus.
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={ref} className='relative' dir='rtl'>
      <Btn
        type='button'
        icon='plus'
        lbl='הוספת שאלה לפני הסיום'
        aria-expanded={open}
        aria-haspopup='menu'
        aria-disabled={disabledReason ? true : undefined}
        onClick={() => !disabledReason && setOpen((o) => !o)}
      />
      {disabledReason && <span className='sr-only'>{disabledReason}</span>}
      {open && (
        <div role='menu' aria-label='איך הלקוח יענה?' className='absolute end-0 top-12 z-10 grid w-64 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg'>
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
