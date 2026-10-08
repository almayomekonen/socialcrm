'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'

/**
 * "איך עוד לקוחות עשויים לכתוב את זה?" — the words a customer may use instead
 * of the option's number or name ("אנחנו מתחתנים" for חתונה). The runtime
 * calls them aliases; the owner never has to.
 *
 * Collapsed by default: most options need none, and an option with twenty
 * phrasings must not push the next option off the screen.
 */
export default function PhrasingsEditor({
  phrasings,
  onChange,
  optionLabel,
  summaryLabel,
}: {
  phrasings: string[]
  onChange: (next: string[]) => void
  optionLabel: string
  /** The toggle's words; default is the Conversation view's question. */
  summaryLabel?: string
}) {
  const id = useId()
  const [text, setText] = useState('')
  const name = optionLabel.trim() || 'האפשרות'
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // After × the cursor stays here: on the phrase that took the removed one's
  // place (or the one before it), or on the box for a new phrase when none is
  // left. Applied once the list has re-rendered without it.
  const focusAfterRemove = useRef<number | null>(null)
  useEffect(() => {
    const at = focusAfterRemove.current
    if (at === null) return
    focusAfterRemove.current = null
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
    ;(buttons[Math.min(at, buttons.length - 1)] ?? inputRef.current)?.focus()
  }, [phrasings])

  const remove = (index: number) => {
    focusAfterRemove.current = index
    onChange(phrasings.filter((_, i) => i !== index))
  }

  const add = () => {
    const value = text.trim()
    if (!value) return
    if (!phrasings.includes(value)) onChange([...phrasings, value])
    setText('')
  }

  return (
    <details className='group'>
      <summary className='cursor-pointer text-xs text-gray-600 underline-offset-2 hover:underline'>
        {summaryLabel ?? 'איך עוד לקוחות עשויים לכתוב את זה?'}
        {phrasings.length > 0 && <span className='text-gray-500'> ({phrasings.length})</span>}
      </summary>
      <div className='mt-2 grid gap-2 ps-1'>
        <p className='text-xs text-gray-500'>
          ניסוחים שהמערכת תזהה כבחירה ב{name === 'האפשרות' ? 'אפשרות הזו' : `"${name}"`}, גם בלי מספר. הם לא נשלחים ללקוח.
        </p>
        {phrasings.length > 0 && (
          <ul ref={listRef} className='flex flex-wrap gap-1.5' aria-label={`ניסוחים עבור ${name}`}>
            {phrasings.map((p, i) => (
              <li
                key={p}
                className='flex items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 ps-3 pe-1 text-sm'
              >
                {p}
                <button
                  type='button'
                  onClick={() => remove(i)}
                  aria-label={`הסרת הניסוח ${p}`}
                  className='flex size-6 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary'
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className='flex items-center gap-2'>
          <label htmlFor={`${id}-new`} className='sr-only'>
            ניסוח נוסף עבור {name}
          </label>
          <input
            ref={inputRef}
            id={`${id}-new`}
            value={text}
            maxLength={40}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder='למשל: אנחנו מתחתנים'
            className='h-9 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2.5 text-sm focus:outline-2 focus:outline-primary'
          />
          <Btn type='button' size='small' variant='outline' lbl='הוספת ניסוח' onClick={add} disabled={!text.trim()} />
        </div>
      </div>
    </details>
  )
}
