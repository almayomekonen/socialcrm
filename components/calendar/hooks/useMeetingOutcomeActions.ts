'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { markMeetingCompleted, markMeetingNoShow, type MarkOutcomeError } from '@/actions/calendar'
import { updateLead } from '@/actions/clients'
import type { SuggestedLeadStatus } from '@/lib/calendar/outcomeStatusSuggestion'

// Hook that owns the outcome-marking lifecycle: action calls, busy state,
// router.refresh, toast feedback. Stage 3 adds a "pending nudge" stage:
// after a successful mark with a suggested lead-status, the hook DOES NOT
// auto-close the dialog. It exposes pendingNudge so the dialog can render
// the LeadStatusNudge banner inline. The rep can then either apply (one
// updateLead call) or dismiss (drops the suggestion + closes).
//
// If the action returns no suggestion (no lead, terminal lead status,
// no_show outcome), onSettled fires immediately — preserving Stage 2's
// under-2-second flow for the common case.

type Busy = 'completed' | 'no_show' | 'nudge' | null

const ERROR_COPY: Record<MarkOutcomeError, string> = {
  invalid_input: 'קלט לא תקין',
  not_found: 'הפגישה לא נמצאה',
  not_owner: 'אינך מורשה לעדכן פגישה זו',
  already_cancelled: 'הפגישה כבר בוטלה',
  already_completed: 'הפגישה כבר סומנה כהושלמה',
  already_no_show: 'הפגישה כבר סומנה כלא הגיע',
}

type PendingNudge = {
  leadId: number
  suggested: SuggestedLeadStatus
}

type RunOpts = {
  // Called when the outcome flow has fully resolved — successful mark with
  // no nudge, successful mark + nudge applied/dismissed, or a failed mark.
  // The dialog uses this to close itself.
  onSettled?: () => void
}

export function useMeetingOutcomeActions(opts: RunOpts = {}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Busy>(null)
  const [pendingNudge, setPendingNudge] = useState<PendingNudge | null>(null)
  const [, startTransition] = useTransition()

  async function markCompleted(meetingId: number) {
    if (busy) return
    setBusy('completed')
    try {
      const result = await markMeetingCompleted({ meetingId })
      if (result.ok === true) {
        toast('success', 'סומן כהושלמה')
        startTransition(() => router.refresh())
        if (result.suggestedLeadStatus && result.leadId) {
          // Hold the dialog open so the rep can act on the nudge.
          setPendingNudge({
            leadId: result.leadId,
            suggested: result.suggestedLeadStatus,
          })
          return
        }
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
        // no_show never returns a suggestion, but defensively respect the
        // shape — if a future change starts emitting one, the same flow runs.
        if (result.suggestedLeadStatus && result.leadId) {
          setPendingNudge({
            leadId: result.leadId,
            suggested: result.suggestedLeadStatus,
          })
          return
        }
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

  async function applyNudge() {
    if (!pendingNudge || busy) return
    setBusy('nudge')
    try {
      await updateLead({ id: pendingNudge.leadId, status: pendingNudge.suggested })
      toast('success', 'סטטוס הליד עודכן')
      startTransition(() => router.refresh())

      setPendingNudge(null)
      opts.onSettled?.()
    } catch (err) {
      console.warn('[calendar.outcome.nudge] updateLead failed', err)
      toast('error', 'עדכון הליד נכשל')
    } finally {
      setBusy(null)
    }
  }

  function dismissNudge() {
    if (busy) return
    setPendingNudge(null)
    opts.onSettled?.()
  }

  return { markCompleted, markNoShow, applyNudge, dismissNudge, busy, pendingNudge }
}
