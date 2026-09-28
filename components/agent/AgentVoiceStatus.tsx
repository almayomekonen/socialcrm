'use client'

import { VOICE_MAX_RECORDING_MS, formatRecordingTime } from '@/lib/agent/voice/limits'
import { CloseIcon } from './promptIcons'
import type { VoiceStatus } from './useVoiceRecorder'

/**
 * What the composer shows in place of its bottom controls while voice input is
 * busy — so it is unmistakable that the microphone is live, how long it has
 * been, and how to get out.
 *
 * Recording: a pulsing red dot, "מקליט", elapsed / maximum, and a cancel.
 * Transcribing: a spinner, "מתמלל…", and a cancel.
 * The stop control is the composer's own action button (it turns into ■).
 */
export default function AgentVoiceStatus({
  status,
  elapsedMs,
  onCancel,
}: {
  status: VoiceStatus
  elapsedMs: number
  onCancel: () => void
}) {
  if (status !== 'recording' && status !== 'transcribing') return null
  const recording = status === 'recording'

  return (
    // While recording, the level meter occupies the strip beside the action
    // button (end-12, w-16), so the row stops short of it; transcribing has no meter.
    <div
      className={`absolute bottom-2 start-3 z-10 flex h-9 items-center gap-2 text-sm ${recording ? 'end-[7.5rem]' : 'end-14'} in-[[data-mobile-workspace]]:static in-[[data-mobile-workspace]]:min-w-0 in-[[data-mobile-workspace]]:flex-1`}
      role='status'
      aria-live='polite'
    >
      {recording ? (
        <>
          <span aria-hidden='true' className='relative flex size-2.5'>
            <span className='absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:animate-none' />
            <span className='relative inline-flex size-2.5 rounded-full bg-red-600' />
          </span>
          <span className='font-medium text-red-700'>מקליט</span>
          <span dir='ltr' className='tabular-nums text-gray-600'>
            {formatRecordingTime(elapsedMs)} / {formatRecordingTime(VOICE_MAX_RECORDING_MS)}
          </span>
        </>
      ) : (
        <>
          <span aria-hidden='true' className='size-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-solid motion-reduce:animate-none' />
          <span className='font-medium text-gray-700'>מתמלל…</span>
        </>
      )}

      <button
        type='button'
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.stopPropagation(); onCancel() }}
        aria-label={recording ? 'ביטול ההקלטה' : 'ביטול התמלול'}
        className='ms-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 outline-none transition-colors hover:bg-gray-100 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary'
      >
        <CloseIcon />
        ביטול
      </button>
    </div>
  )
}
