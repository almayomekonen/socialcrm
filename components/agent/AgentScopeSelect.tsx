'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import MorphingText from './MorphingText'
import { ModeMarkIcon } from './promptIcons'

/**
 * The scope pill and its popover — "what should the agent look at".
 *
 * ONE SLIDING HIGHLIGHT, not a per-row hover background: a single absolutely
 * positioned block translates to the hovered row, so the highlight travels
 * between options instead of blinking on and off. It starts at opacity 0 so it
 * does not flash in at the top of the list before the pointer arrives.
 *
 * `origin-bottom-left rtl:origin-bottom-right` because there is no logical
 * equivalent of `transform-origin`, and the panel is anchored to the inline
 * start of the pill — which is the visual right in Hebrew.
 */
export default function AgentScopeSelect({
  scopes,
  value,
  onChange,
  open,
  onOpenChange,
}: {
  scopes: string[]
  value: string
  onChange: (next: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [highlight, setHighlight] = useState({ opacity: 0, transform: 'translateY(0px) scale(0.95)', transition: 'none' })

  return (
    <div className='relative'>
      <button
        type='button'
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        aria-expanded={open}
        aria-label={`תחום החיפוש: ${value}`}
        className={cn(
          'group flex items-center gap-1 rounded-full px-2 py-1 text-white/55 outline-none transition-all duration-200',
          'hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60',
          open && 'bg-white/10 text-white',
        )}
      >
        <ModeMarkIcon />
        <span className='select-none text-xs font-semibold'>
          <MorphingText text={value} />
        </span>
      </button>

      <div
        onMouseLeave={() => setHighlight((p) => ({ ...p, opacity: 0, transition: 'opacity 0.2s ease-in' }))}
        className={cn(
          'absolute bottom-full start-0 z-50 mb-2.5 flex w-44 origin-bottom-left flex-col gap-0.5 rounded-2xl',
          'border border-white/10 bg-ink/95 p-1 shadow-xl backdrop-blur-md transition-all duration-300 rtl:origin-bottom-right',
          open
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100 ease-[cubic-bezier(0.34,1.56,0.64,1)]'
            : 'pointer-events-none translate-y-3 scale-95 opacity-0',
        )}
      >
        <div className='relative flex flex-col gap-0.5'>
          <div style={highlight} className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-8 rounded-xl bg-white/10' />
          {scopes.map((scope, idx) => (
            <button
              key={scope}
              type='button'
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() =>
                setHighlight((p) => ({
                  opacity: 1,
                  transform: `translateY(${idx * 34}px) scale(1)`,
                  transition:
                    p.opacity === 0
                      ? 'opacity 0.15s ease-out'
                      : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.15s ease',
                }))
              }
              onClick={(e) => {
                e.stopPropagation()
                onChange(scope)
                onOpenChange(false)
              }}
              aria-current={scope === value}
              className='group relative flex h-8 w-full items-center rounded-xl px-2.5 py-1.5 text-start text-xs font-medium text-white/80 outline-none transition-colors hover:text-white active:scale-[0.98]'
            >
              <span className='flex items-center gap-2'>
                <ModeMarkIcon />
                {scope}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
