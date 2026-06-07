'use client'

import Icon from '@/lib/Icon'
import { COPILOT_MODES, type CopilotModeId } from '@/lib/ai/copilotModes'
import { POP_KEYFRAMES } from './constants'

export function ModePopover({
  activeId,
  onSelect,
}: {
  activeId: CopilotModeId
  onSelect: (id: CopilotModeId) => void
}) {
  return (
    <div
      role='menu'
      className={[
        'absolute bottom-full mb-2 inline-flex flex-col gap-0.5',
        'rounded-2xl bg-white border border-gray-200 p-1.5 min-w-[240px]',
        'shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]',
        'end-2',
      ].join(' ')}
      style={{ animation: 'cp-pop-in 140ms ease-out' }}
    >
      <style>{POP_KEYFRAMES}</style>
      <div className='px-2.5 pt-1 pb-1 text-[10.5px] text-gray-400 tracking-wide'>מצב AI</div>
      {COPILOT_MODES.map((mode) => {
        const isSelected = mode.id === activeId
        return (
          <button
            key={mode.id}
            type='button'
            role='menuitemradio'
            aria-checked={isSelected}
            onClick={() => onSelect(mode.id)}
            className={[
              'group flex items-start gap-2 w-full px-2.5 py-2 rounded-xl text-start transition-colors duration-150',
              isSelected ? 'bg-primary-tint' : 'hover:bg-gray-50',
            ].join(' ')}
          >
            <Icon
              name={mode.icon}
              type='reg'
              className={`size-3.5 shrink-0 mt-0.5 transition-colors ${isSelected ? 'bg-primary' : 'bg-gray-400 group-hover:bg-primary'}`}
            />
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-1.5'>
                <span
                  className={`text-[12.5px] font-medium transition-colors ${isSelected ? 'text-primary-text' : 'text-gray-700 group-hover:text-gray-900'}`}
                >
                  {mode.label}
                </span>
                {mode.requiredTier === 'pro' && (
                  <span
                    className='text-[9.5px] font-bold tracking-wider px-1.5 py-px rounded bg-gray-900 text-white'
                    aria-label='זמין ב-Pro'
                  >
                    PRO
                  </span>
                )}
                {isSelected && (
                  <Icon name='check' type='reg' className='size-3 bg-primary shrink-0' aria-hidden='true' />
                )}
              </div>
              <p
                className={`text-[10.5px] leading-snug mt-0.5 transition-colors ${isSelected ? 'text-primary-text/80' : 'text-gray-500'}`}
              >
                {mode.description}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
