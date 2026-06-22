'use client'

import { useEffect, useState } from 'react'

/**
 * Decorative "a lead just arrived" toast that cycles through the user's real
 * lead names over the blurred dashboard behind the trial-expired card. Names
 * come from CRM data (never invented); the framing is "ממתין" (waiting), not
 * "new", because these are existing saved leads. Purely visual — never
 * interactive (pointer-events-none) and never blocks the gate underneath.
 */
export default function LeadEntryToasts({ names }: { names: string[] }) {
  const [idx, setIdx] = useState(0)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (names.length === 0) return
    setShow(true)
    const hide = setTimeout(() => setShow(false), 2600)
    const next = setTimeout(() => setIdx((i) => (i + 1) % names.length), 3200)
    return () => {
      clearTimeout(hide)
      clearTimeout(next)
    }
  }, [idx, names])

  if (names.length === 0) return null
  const name = names[idx] || 'ליד'

  return (
    <div className='pointer-events-none absolute inset-x-0 top-10 z-0 flex justify-center px-4'>
      <div
        dir='rtl'
        className={`flex items-center gap-3 rounded-xl bg-white/95 px-4 py-3 shadow-xl ring-1 ring-black/5 transition-all duration-500 ease-out motion-reduce:transition-none ${
          show ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        }`}
      >
        <span className='grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-700'>
          {name.trim().charAt(0)}
        </span>
        <div className='min-w-0'>
          <p className='text-[11px] font-medium leading-none text-emerald-600'>ליד ממתין</p>
          <p className='mt-0.5 truncate text-sm font-semibold text-gray-900'>{name}</p>
        </div>
        <span className='ms-2 size-2 shrink-0 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none' aria-hidden='true' />
      </div>
    </div>
  )
}
