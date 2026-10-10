'use client'

import { useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import type { NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import QuestionKindMenu from './QuestionKindMenu'

/**
 * "+ הוספת שאלה לפני הסיום" (or, on an empty questionnaire, "הוספת השאלה
 * הראשונה"): pick how the customer answers; the question is added last and
 * connected. The menu is QuestionKindMenu, shared with "+" on the arrows.
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
        <QuestionKindMenu
          className={`absolute ${opens === 'above' ? 'bottom-12 start-1/2 translate-x-1/2' : 'start-0 top-12'}`}
          isInside={(t) => !!ref.current?.contains(t)}
          onPick={(kind) => {
            setOpen(false)
            onAdd(kind)
          }}
          onClose={(returnFocus) => {
            setOpen(false)
            // Dismissed from the keyboard: back to the button that opened the menu.
            if (returnFocus) ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus()
          }}
        />
      )}
    </div>
  )
}
