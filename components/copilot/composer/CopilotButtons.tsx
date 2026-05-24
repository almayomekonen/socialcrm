'use client'

import Icon from '@/lib/Icon'
import type { CopilotMode } from '@/lib/ai/copilotModes'

const ROUND_BTN_BASE =
  'shrink-0 inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

export function AttachButton({ open, disabled, onToggle }: { open: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup='menu'
      aria-expanded={open}
      aria-label='הוסף הקשר מהליד'
      title='הוסף הקשר מהליד'
      className={[ROUND_BTN_BASE, open ? 'bg-indigo-50' : 'hover:bg-gray-50'].join(' ')}
    >
      <Icon name='plus' type='reg' className={`size-4 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-500'}`} />
    </button>
  )
}

export function ToolsButton({
  open,
  disabled,
  onToggle,
  loading,
}: {
  open: boolean
  disabled: boolean
  onToggle: () => void
  loading: boolean
}) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup='menu'
      aria-expanded={open}
      aria-label='כלים'
      title='כלים'
      className={[ROUND_BTN_BASE, open ? 'bg-indigo-50' : 'hover:bg-gray-50'].join(' ')}
    >
      {loading ? (
        <span
          className='inline-block size-2.5 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin'
          aria-hidden='true'
        />
      ) : (
        <Icon
          name='sliders-simple'
          type='reg'
          className={`size-4 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-500'}`}
        />
      )}
    </button>
  )
}

export function SendButton({ ready, loading, onClick }: { ready: boolean; loading: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={!ready}
      aria-label='שלח שאלה'
      title='שלח (Enter)'
      className={[
        'shrink-0 inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        ready ? 'bg-gray-900 hover:bg-gray-800 cursor-pointer' : 'bg-gray-100 cursor-not-allowed',
      ].join(' ')}
    >
      {loading ? (
        <span
          className='inline-block size-3 rounded-full border-2 border-white/40 border-t-white animate-spin'
          aria-hidden='true'
        />
      ) : (
        <Icon
          name='arrow-up'
          type='reg'
          className={`size-3.5 transition-colors ${ready ? 'bg-white' : 'bg-gray-400'}`}
        />
      )}
    </button>
  )
}

export function ModeButton({
  open,
  disabled,
  mode,
  onToggle,
}: {
  open: boolean
  disabled: boolean
  mode: CopilotMode
  onToggle: () => void
}) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup='menu'
      aria-expanded={open}
      aria-label={`מצב AI: ${mode.label}`}
      title={`מצב AI: ${mode.label}`}
      className={[
        'shrink-0 inline-flex items-center gap-1 h-7 ps-2 pe-1.5 rounded-full transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        open ? 'bg-indigo-50' : 'hover:bg-gray-50',
      ].join(' ')}
    >
      <Icon name={mode.icon} type='reg' className={`size-3.5 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-500'}`} />
      <span
        className={`text-[12px] font-medium leading-none transition-colors ${open ? 'text-indigo-700' : 'text-gray-700'}`}
      >
        {mode.label}
      </span>
      <Icon
        name='chevron-down'
        type='reg'
        className={`size-2.5 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-400'}`}
      />
    </button>
  )
}
