'use client'

import { useEffect, useRef } from 'react'
import type { NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'

const KINDS: Array<{ kind: NewQuestionKind; label: string; hint: string }> = [
  { kind: 'single_choice', label: 'בחירה של תשובה אחת', hint: 'הלקוח בוחר אחת מהרשימה' },
  { kind: 'multi_choice', label: 'בחירה של כמה תשובות', hint: 'הלקוח יכול לבחור כמה' },
  { kind: 'text', label: 'תשובה חופשית', hint: 'הלקוח כותב במילים שלו' },
]

/**
 * "איך הלקוח יענה?" — the one menu every way of adding a question opens
 * ("+ הוספת שאלה לפני הסיום", the empty state, "+" on an arrow). The first
 * choice takes focus; Escape closes it (`onClose(true)`: give focus back to
 * the opener); a click anywhere else closes it (`onClose(false)`) — listened
 * in the capture phase, because the map's pan handler stops mousedown from
 * bubbling. Closing never adds anything; only a choice does.
 */
export default function QuestionKindMenu({
  onPick,
  onClose,
  isInside,
  className = '',
  style,
}: {
  onPick: (kind: NewQuestionKind) => void
  onClose: (returnFocus: boolean) => void
  /** Clicks here do not count as "outside" (the opener toggles the menu itself). */
  isInside?: (target: Node) => boolean
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ onClose, isInside })
  latest.current = { onClose, isInside }

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') latest.current.onClose(true)
        return
      }
      const t = e.target as Node
      if (!ref.current?.contains(t) && !latest.current.isInside?.(t)) latest.current.onClose(false)
    }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('keydown', close)
    }
  }, [])

  return (
    <div
      ref={ref}
      role='menu'
      aria-label='איך הלקוח יענה?'
      dir='rtl'
      style={style}
      className={`z-10 grid w-64 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg ${className}`}
    >
      <p className='px-2 pb-1 text-xs text-gray-500'>איך הלקוח יענה?</p>
      {KINDS.map((k) => (
        <button
          key={k.kind}
          type='button'
          role='menuitem'
          onClick={() => onPick(k.kind)}
          className='grid rounded-md px-2 py-1.5 text-start hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary'
        >
          <span className='text-sm font-medium text-ink'>{k.label}</span>
          <span className='text-xs text-gray-500'>{k.hint}</span>
        </button>
      ))}
    </div>
  )
}
