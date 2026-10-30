'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { markMeetingCompleted, markMeetingNoShow, type MarkOutcomeError } from '@/actions/calendar'
import { updateLead } from '@/actions/clients'
import type { SuggestedLeadStatus } from '@/lib/calendar/outcomeStatusSuggestion'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

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

/** Refusals by reason CODE, in the interface language (Hebrew outside a provider). */
const ERROR_KEY: Record<MarkOutcomeError, MessageKey> = {
  invalid_input: 'calendar.outcome.error.invalid_input',
  not_found: 'calendar.outcome.error.not_found',
  not_owner: 'calendar.outcome.error.not_owner',
  already_cancelled: 'calendar.outcome.error.already_cancelled',
  already_completed: 'calendar.outcome.error.already_completed',
  already_no_show: 'calendar.outcome.error.already_no_show',
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
  const t = useT()
  const [busy, setBusy] = useState<Busy>(null)
  const [pendingNudge, setPendingNudge] = useState<PendingNudge | null>(null)
  const [, startTransition] = useTransition()

  async function markCompleted(meetingId: number) {
    if (busy) return
    setBusy('completed')
    try {
      const result = await markMeetingCompleted({ meetingId })
      if (result.ok === true) {
        toast('success', t('calendar.outcome.completed'))
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
      toast('error', t(ERROR_KEY[result.reason] ?? 'calendar.outcome.failed'))
    } catch (err) {
      console.warn('[calendar.outcome.completed] unexpected error', err)
      toast('error', t('calendar.outcome.unexpected'))
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
        toast('success', t('calendar.outcome.noShow'))
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
      toast('error', t(ERROR_KEY[result.reason] ?? 'calendar.outcome.failed'))
    } catch (err) {
      console.warn('[calendar.outcome.no_show] unexpected error', err)
      toast('error', t('calendar.outcome.unexpected'))
    } finally {
      setBusy(null)
    }
  }

  async function applyNudge() {
    if (!pendingNudge || busy) return
    setBusy('nudge')
    try {
      await updateLead({ id: pendingNudge.leadId, status: pendingNudge.suggested })
      toast('success', t('calendar.outcome.leadUpdated'))
      startTransition(() => router.refresh())

      setPendingNudge(null)
      opts.onSettled?.()
    } catch (err) {
      console.warn('[calendar.outcome.nudge] updateLead failed', err)
      toast('error', t('calendar.outcome.leadUpdateFailed'))
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
