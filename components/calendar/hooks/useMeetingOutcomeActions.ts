'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import {
  markMeetingCompleted,
  markMeetingNoShow,
  type MarkOutcomeError,
} from '@/actions/calendar'

// Hook that owns the outcome-marking lifecycle: action calls, busy state,
// router.refresh, toast feedback. Single hook keeps the busy state shared
// across the two mutually-exclusive outcome buttons (rep can't fire both
// at once) and centralises the Hebrew reason-code → toast mapping so future
// callers (e.g., a dashboard inline-action card in Stage 5) reuse the
// behaviour rather than re-implement it.

type Busy = 'completed' | 'no_show' | null

// Maps action result error codes to Hebrew toast copy. Typed as
// Record<MarkOutcomeError, string> so a future reason added to the action
// fails the build until copy is added — prevents the silent fall-through
// to a generic "עדכון נכשל" that drops the specificity the new
// already_cancelled / already_completed / already_no_show split delivers.
const ERROR_COPY: Record<MarkOutcomeError, string> = {
  invalid_input: 'קלט לא תקין',
  not_found: 'הפגישה לא נמצאה',
  not_owner: 'אינך מורשה לעדכן פגישה זו',
  already_cancelled: 'הפגישה כבר בוטלה',
  already_completed: 'הפגישה כבר סומנה כהושלמה',
  already_no_show: 'הפגישה כבר סומנה כלא הגיע',
}

type RunOpts = {
  // Called on success — caller decides whether to close the dialog.
  onSettled?: () => void
}

export function useMeetingOutcomeActions(opts: RunOpts = {}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Busy>(null)
  const [, startTransition] = useTransition()

  async function markCompleted(meetingId: number) {
    if (busy) return
    setBusy('completed')
    try {
      const result = await markMeetingCompleted({ meetingId })
      if (result.ok === true) {
        toast('success', 'סומן כהושלמה')
        startTransition(() => router.refresh())
        opts.onSettled?.()
        return
      }
      toast('error', ERROR_COPY[result.reason] ?? 'עדכון הפגישה נכשל')
    } catch (err) {
      console.warn('[calendar.outcome.completed] unexpected error', err)
      toast('error', 'אירעה שגיאה. נסה שוב.')
    } finally {
      setBusy(null)
    }
  }

  async function markNoShow(meetingId: number) {
    if (busy) return
    setBusy('no_show')
    try {
      const result = await markMeetingNoShow({ meetingId })
      if (result.ok === true) {
        toast('success', 'סומן כלא הגיע')
        startTransition(() => router.refresh())
        opts.onSettled?.()
        return
      }
      toast('error', ERROR_COPY[result.reason] ?? 'עדכון הפגישה נכשל')
    } catch (err) {
      console.warn('[calendar.outcome.no_show] unexpected error', err)
      toast('error', 'אירעה שגיאה. נסה שוב.')
    } finally {
      setBusy(null)
    }
  }

  return { markCompleted, markNoShow, busy }
}
