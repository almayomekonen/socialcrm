'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'

/**
 * Minimal General-Mode composer: a text input + send. Intentionally NOT the
 * lead-mode CopilotComposer, whose lenses/attachments/modes/predefined-actions
 * are lead-specific and would surface irrelevant disabled controls here.
 */
export default function GeneralComposer({ onSubmit, busy }: { onSubmit: (text: string) => void; busy: boolean }) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const ready = trimmed.length > 0 && !busy

  function submit() {
    if (!ready) return
    onSubmit(trimmed)
    setValue('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className='flex items-end gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5'>
      <textarea
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder='שאל את העוזר…'
        className='max-h-24 flex-1 resize-none bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400'
      />
      <button
        type='button'
        onClick={submit}
        disabled={!ready}
        aria-label='שלח'
        className='shrink-0 rounded-full p-1.5 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors'
      >
        <Icon name='arrow-up' type='reg' className='size-4 bg-gray-800' />
      </button>
    </div>
  )
}
