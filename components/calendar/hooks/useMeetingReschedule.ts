'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { EventDropArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { toast } from '@/lib/toast'
import { updateMeeting, type MeetingSummaryDTO } from '@/actions/calendar'
import { useT } from '@/lib/i18n/I18nProvider'
import { REFUSAL_KEY, rescheduleFeedback } from './rescheduleFeedback'

/**
 * The calendar grid's reschedule gestures: drag (move) and resize (change the
 * end). Extracted from CalendarView, which had crossed the 350-line hard limit
 * (architecture-rules §1/§5). Same guards in the same order, same reverts,
 * same toasts; the result → toast mapping the two shared lives in
 * `rescheduleFeedback`. Toasts follow the interface language (Hebrew outside a
 * provider).
 *
 * `expired` / `promptMove` come from the view, which owns the entitlement
 * answer for every paid action on the page.
 */

// Action-layer minimum is 5 min; mirror it here so a fumbled resize fails
// fast without the round-trip + revert dance.
const MIN_DURATION_MS = 5 * 60 * 1000

type Opts = {
  expired: boolean
  promptMove: () => void
}

export function useMeetingReschedule({ expired, promptMove }: Opts) {
  const router = useRouter()
  const t = useT()
  // Single busy flag covers drag AND resize — they're mutually exclusive
  // gestures, and the visual treatment (dim + progress cursor) is identical.
  const [dragBusy, setDragBusy] = useState(false)
  const [, startTransition] = useTransition()

  // listUpcomingMeetings was widened in Stage 2 to include completed +
  // no_show meetings so the rep can see outcomes on the grid. These
  // handlers MUST guard against terminal-state meetings — moving a
  // completed meeting in the calendar would re-send Google invites for
  // a meeting the lead already attended AND break the audit invariant
  // that completed_at correlates with the actual start_at.
  async function handleEventDrop(arg: EventDropArg) {
    // Revert first, exactly as every other refusal in this handler does, so the
    // event snaps back and nothing is sent.
    if (expired) {
      arg.revert()
      return promptMove()
    }
    const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
    const newStart = arg.event.start
    if (!meeting || !newStart) {
      arg.revert()
      return
    }

    if (meeting.status !== 'scheduled') {
      arg.revert()
      toast('error', t(REFUSAL_KEY.moveMarked))
      return
    }

    // Month-view drops don't always set end. Preserve the original duration
    // so a month-grid drag doesn't accidentally resize the meeting.
    const existingStart = new Date(meeting.startAt)
    const existingEnd = new Date(meeting.endAt)
    const newEnd =
      arg.event.end ??
      new Date(newStart.getTime() + (existingEnd.getTime() - existingStart.getTime()))

    // No-op drop (e.g. fumbled click that registered as a drag).
    if (
      newStart.getTime() === existingStart.getTime() &&
      newEnd.getTime() === existingEnd.getTime()
    ) {
      return
    }

    // Block drops that land in the past. The user just rescheduled a meeting
    // to "before now," which is almost always a fumbled drag (especially in
    // week view where vertical drag can cross day boundaries).
    if (newStart.getTime() < Date.now()) {
      arg.revert()
      toast('error', t(REFUSAL_KEY.movePast))
      return
    }

    if (dragBusy) {
      arg.revert()
      // Silent revert would look like the calendar is broken — tell the user
      // why their drop didn't stick.
      toast('error', t(REFUSAL_KEY.busy))
      return
    }
    setDragBusy(true)

    try {
      // sendUpdates='externalOnly' keeps the organizer's own inbox quiet on
      // every nudge. External attendees (leads) still receive the updated
      // invite — which is the whole point of syncing the reschedule.
      const result = await updateMeeting({
        meetingId: meeting.id,
        startAt: newStart.toISOString(),
        endAt: newEnd.toISOString(),
        sendUpdates: 'externalOnly',
      })
      settle(arg, rescheduleFeedback('move', result))
    } catch (err) {
      console.warn('[calendar.drag] unexpected error', err)
      arg.revert()
      toast('error', t(REFUSAL_KEY.unexpected))
    } finally {
      setDragBusy(false)
    }
  }

  // Resize only changes the end time. FullCalendar's resize gesture
  // exclusively drags the end edge — the start is anchored. Otherwise this
  // mirrors handleEventDrop: same throttle, same sync-status mapping, same
  // conflict and revert rules.
  //
  // We intentionally do NOT block "end-in-the-past" resizes: shortening a
  // currently-running meeting to "ended just now" is a legitimate gesture
  // ("the meeting ran short"). Server still rejects end <= start and the
  // 5-min floor catches accidental zero-durations.
  async function handleEventResize(arg: EventResizeDoneArg) {
    if (expired) {
      arg.revert()
      return promptMove()
    }
    const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
    const newEnd = arg.event.end
    // Use FullCalendar's internal view of start/end (arg.event / arg.oldEvent)
    // rather than meeting.startAt / meeting.endAt — props can be stale if a
    // previous drag's router.refresh() hasn't landed yet. FC has the truth.
    const anchorStart = arg.event.start ?? new Date(meeting?.startAt ?? 0)
    const previousEnd = arg.oldEvent.end ?? new Date(meeting?.endAt ?? 0)

    if (!meeting || !newEnd) {
      arg.revert()
      return
    }

    if (meeting.status !== 'scheduled') {
      arg.revert()
      toast('error', t(REFUSAL_KEY.resizeMarked))
      return
    }

    const newDurationMs = newEnd.getTime() - anchorStart.getTime()

    // Same-end no-op — guards against a tap on the handle without a real drag.
    if (newEnd.getTime() === previousEnd.getTime()) {
      return
    }

    // Mirror the action's 5-minute floor here to fail fast without a round-trip.
    if (newDurationMs < MIN_DURATION_MS) {
      arg.revert()
      toast('error', t(REFUSAL_KEY.tooShort))
      return
    }

    if (dragBusy) {
      arg.revert()
      toast('error', t(REFUSAL_KEY.busy))
      return
    }
    setDragBusy(true)

    try {
      const result = await updateMeeting({
        meetingId: meeting.id,
        // Only endAt changes on resize. Sending startAt would be redundant.
        endAt: newEnd.toISOString(),
        sendUpdates: 'externalOnly',
      })
      settle(arg, rescheduleFeedback('resize', result))
    } catch (err) {
      console.warn('[calendar.resize] unexpected error', err)
      arg.revert()
      toast('error', t(REFUSAL_KEY.unexpected))
    } finally {
      setDragBusy(false)
    }
  }

  /**
   * A change the CRM kept (success, or the etag conflict — CRM-first means the
   * local write already landed, so reverting the visual would diverge from the
   * DB) toasts and refreshes; anything else reverts the gesture, then toasts.
   */
  function settle(arg: { revert: () => void }, fb: ReturnType<typeof rescheduleFeedback>) {
    if (fb.kept) {
      toast(fb.tone, t(fb.message))
      startTransition(() => router.refresh())
      return
    }
    arg.revert()
    toast(fb.tone, t(fb.message))
  }

  return { dragBusy, handleEventDrop, handleEventResize }
}
