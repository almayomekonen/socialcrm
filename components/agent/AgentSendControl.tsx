'use client'

import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUpIcon, MicIcon, StopIcon } from './promptIcons'

/**
 * The composer's one action control, plus the level meter that shares its corner.
 *
 * ONE BUTTON, THREE FACES. Send, dictate and stop are the same circle: all three
 * glyphs are stacked and cross-faded with a small counter-rotation, so the
 * control morphs in place instead of swapping elements. A row of three separate
 * buttons would be three tap targets for what is always exactly one available
 * action.
 *
 * The meter bars are heights driven by live microphone levels — see
 * `useVoiceInput`, which has no simulated mode. When nothing is recording the
 * strip collapses to zero width rather than hiding, so the button does not jump.
 */
export default function AgentSendControl({
  mode,
  levels,
  recording,
  disabled,
  onClick,
}: {
  mode: 'send' | 'mic' | 'stop' | 'idle'
  levels: number[]
  recording: boolean
  disabled: boolean
  onClick: (e: MouseEvent) => void
}) {
  const faces = [
    { key: 'send', icon: <ArrowUpIcon />, rotate: 'rotate-45' },
    { key: 'mic', icon: <MicIcon />, rotate: '-rotate-45' },
    { key: 'stop', icon: <StopIcon />, rotate: 'rotate-45' },
  ] as const

  const label = mode === 'send' ? 'שליחה' : mode === 'stop' ? 'עצירת ההקלטה' : 'הקלדה קולית'

  return (
    <>
      <div
        aria-hidden={!recording}
        className={cn(
          'absolute bottom-2 end-12 z-10 flex h-8 items-center justify-end gap-[3px]',
          'transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
          recording ? 'w-16 translate-x-0 opacity-100' : 'pointer-events-none w-0 translate-x-4 opacity-0',
        )}
      >
        {levels.map((v, i) => (
          <div
            key={i}
            className='w-1 rounded-full bg-accent transition-[height] duration-75 ease-out'
            style={{ height: `${Math.max(4, v * 24)}px` }}
          />
        ))}
      </div>

      <button
        type='button'
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'tap-44 absolute bottom-2 end-2 z-10 flex size-9 items-center justify-center rounded-full',
          'bg-white text-ink outline-none transition-all duration-300',
          'hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40',
        )}
      >
        <span className='relative flex size-full items-center justify-center'>
          {faces.map((face) => {
            const show = mode === face.key
            return (
              <span
                key={face.key}
                className={cn(
                  'absolute inset-0 flex items-center justify-center',
                  'transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] motion-reduce:transition-none',
                  show ? 'rotate-0 scale-100 opacity-100 blur-none' : `pointer-events-none scale-50 opacity-0 blur-[1px] ${face.rotate}`,
                )}
              >
                {face.icon}
              </span>
            )
          })}
        </span>
      </button>
    </>
  )
}
