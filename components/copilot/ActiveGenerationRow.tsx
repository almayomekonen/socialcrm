'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'

type Props = {
  fallbackLabel: string
  hint: 'attachments' | 'general' | 'general-mode'
  /**
   * 'steps' (default) = show progressive text immediately — existing behavior for
   * Lead Mode (CopilotTimeline). 'pulse' = start with a silent sparkle pulse that
   * claims no work, escalating to step text only after `escalateAfterMs` (if given).
   * This keeps deterministic/fast paths from ever showing fabricated progress.
   */
  startPhase?: 'pulse' | 'steps'
  escalateAfterMs?: number
}

const GENERAL_STATES = ['מנתח את הקשר הליד', 'סוקר פעילות אחרונה', 'מגבש תשובה']
const ATTACHMENT_STATES = ['קורא את הקובץ המצורף', 'מנתח את תוכן המסמך', 'מחלץ מידע מהקובץ', 'מגבש תשובה']
// No-lead General Mode: same animation, lead-free wording.
const GENERAL_MODE_STATES = ['בודק את הנתונים', 'סוקר את הפעילות', 'מגבש תשובה']

const CYCLE_MS = 2400

function statesFor(hint: Props['hint']): string[] {
  if (hint === 'attachments') return ATTACHMENT_STATES
  if (hint === 'general-mode') return GENERAL_MODE_STATES
  return GENERAL_STATES
}

export default function ActiveGenerationRow({ fallbackLabel, hint, startPhase = 'steps', escalateAfterMs }: Props) {
  const states = statesFor(hint)
  const [phase, setPhase] = useState<'pulse' | 'steps'>(startPhase)
  const [idx, setIdx] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Pulse → steps escalation: only when we started in pulse AND a threshold is set.
  // A path that resolves before the threshold never shows the step text at all.
  useEffect(() => {
    if (phase !== 'pulse' || escalateAfterMs == null) return
    const t = setTimeout(() => setPhase('steps'), escalateAfterMs)
    return () => clearTimeout(t)
  }, [phase, escalateAfterMs])

  // Step cycling — runs only while in the steps phase.
  useEffect(() => {
    if (phase !== 'steps') return
    setIdx(0)
    intervalRef.current = setInterval(() => {
      setIdx((prev) => {
        const next = prev + 1
        if (next >= states.length) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return prev
        }
        return next
      })
    }, CYCLE_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [phase, states])

  const label = states[idx] ?? fallbackLabel

  return (
    <div
      className='flex items-center gap-2 px-1 py-2 text-[12.5px] text-gray-500'
      role='status'
      aria-live='polite'
    >
      <span className='cp-spark inline-flex items-center justify-center shrink-0'>
        <Icon name='sparkles' type='reg' className='size-3.5 bg-gray-500' />
      </span>
      {phase === 'steps' && (
        <span key={idx} className='cp-spark-text truncate'>
          {label}
        </span>
      )}
    </div>
  )
}
