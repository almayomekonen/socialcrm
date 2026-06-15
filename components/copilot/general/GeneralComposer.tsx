'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_COPILOT_MODE_ID, getCopilotMode, type CopilotModeId } from '@/lib/ai/copilotModes'
import { readPersistedMode, writePersistedMode } from '@/lib/copilot/copilotModeState'
import { ModeButton, SendButton } from '../composer/CopilotButtons'
import { ModePopover } from '../composer/ModePopover'
import { useOutsidePopoverClose } from '../composer/useOutsidePopoverClose'
import { MAX_TEXTAREA_HEIGHT } from '../composer/constants'

/**
 * General-Mode composer. Reuses the lead composer's premium building blocks —
 * the same input-box styling, the Fast/Smart/Advanced ModeButton + ModePopover,
 * the SendButton, and the shared mode persistence — but omits the lead-only
 * Tools/Attach/lenses popovers. Premium shell, bounded brain.
 */
export default function GeneralComposer({
  onSubmit,
  busy,
}: {
  onSubmit: (text: string, mode: CopilotModeId) => void
  busy: boolean
}) {
  const [value, setValue] = useState('')
  const [modeId, setModeId] = useState<CopilotModeId>(DEFAULT_COPILOT_MODE_ID)
  const [modeOpen, setModeOpen] = useState(false)
  const composerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setModeId(readPersistedMode())
  }, [])

  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  useOutsidePopoverClose({ composerRef, anyOpen: modeOpen, closeAll: () => setModeOpen(false) })

  const trimmed = value.trim()
  const ready = trimmed.length > 0 && !busy

  function selectMode(id: CopilotModeId) {
    setModeId(id)
    writePersistedMode(id)
    setModeOpen(false)
  }

  function submit() {
    if (!ready) return
    onSubmit(trimmed, modeId)
    setValue('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div ref={composerRef} className='relative w-full'>
      <div className='rounded-2xl border border-gray-200 bg-white px-2.5 pt-2 pb-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='שאל את העוזר…'
          className='block w-full resize-none bg-transparent text-[13px] leading-5 text-gray-800 outline-none placeholder:text-gray-400'
        />
        <div className='mt-1.5 flex items-center justify-between'>
          <ModeButton open={modeOpen} disabled={busy} mode={getCopilotMode(modeId)} onToggle={() => setModeOpen((o) => !o)} />
          <SendButton ready={ready} loading={busy} onClick={submit} />
        </div>
      </div>

      {modeOpen && <ModePopover activeId={modeId} onSelect={selectMode} />}
    </div>
  )
}
