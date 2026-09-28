'use client'

import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUpIcon, MicIcon, StopIcon } from './promptIcons'

/**
 * The composer's one action control, plus the level meter that shares its corner.
 *
 * ONE BUTTON, FOUR FACES. Send, record, stop and busy are the same circle: all
 * four glyphs are stacked and cross-faded with a small counter-rotation, so the
 * control morphs in place instead of swapping elements. A row of three separate
 * buttons would be three tap targets for what is always exactly one available
 * action.
 *
 * The meter bars are heights driven by live microphone levels — see
 * `useVoiceRecorder`, which has no simulated mode. `busy` covers the permission
 * prompt and the transcription: the button is disabled, so neither can be
 * started twice. When nothing is recording the
 * strip collapses to zero width rather than hiding, so the button does not jump.
 */
export default function AgentSendControl({
  mode,
  levels,
  recording,
  disabled,
  onClick,
}: {
  mode: 'send' | 'mic' | 'stop' | 'busy' | 'idle'
  levels: number[]
  recording: boolean
  disabled: boolean
  onClick: (e: MouseEvent) => void
}) {
  const faces = [
    { key: 'send', icon: <ArrowUpIcon />, rotate: 'rotate-45' },
    { key: 'mic', icon: <MicIcon />, rotate: '-rotate-45' },
    { key: 'stop', icon: <StopIcon />, rotate: 'rotate-45' },
    {
      key: 'busy',
      icon: <span aria-hidden='true' className='size-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none' />,
      rotate: '-rotate-45',
    },
  ] as const

  const label =
    mode === 'send' ? 'שליחה' : mode === 'stop' ? 'עצירת ההקלטה ותמלול' : mode === 'busy' ? 'ממתין…' : 'הקלטה קולית'

  return (
    <>
      <div
        aria-hidden={!recording}
        className={cn(
          'absolute bottom-2 end-12 z-10 flex h-8 items-center justify-end gap-[3px]',
          // Mobile: in flow, in the composer's bottom row (see AgentPromptInput).
          'in-[[data-mobile-workspace]]:static in-[[data-mobile-workspace]]:shrink-0',
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
          'tap-44 absolute bottom-2 end-2 z-10 flex size-9 items-center justify-center rounded-md',
          // Mobile: an in-flow item of the composer's bottom row, so it can never
          // sit outside the input. `relative` (not `static`) keeps it the anchor
          // for its own 44px `.tap-44` hit area; `inset-auto` drops the offsets.
          'in-[[data-mobile-workspace]]:relative in-[[data-mobile-workspace]]:inset-auto in-[[data-mobile-workspace]]:shrink-0',
          'bg-solid text-white outline-none transition-all duration-300',
          'hover:bg-solid/85 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40',
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
