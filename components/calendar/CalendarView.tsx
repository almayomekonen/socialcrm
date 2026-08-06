'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import heLocale from '@fullcalendar/core/locales/he'
import type {
  EventInput,
  EventClickArg,
  EventDropArg,
  DateSelectArg,
} from '@fullcalendar/core'
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction'
import './calendar.css'

import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { toast } from '@/lib/toast'
import {
  cancelMeeting,
  retrySyncMeeting,
  updateMeeting,
  type MeetingSummaryDTO,
} from '@/actions/calendar'
import MeetingFormDialog from './MeetingFormDialog'
import MeetingDetailsDialog from './MeetingDetailsDialog'
import MeetingEditDialog from './MeetingEditDialog'
import { toEventInput, renderEventContent } from './eventRendering'

const FullCalendar = dynamic(() => import('@fullcalendar/react'), {
  ssr: false,
  loading: () => (
    <div className='h-[600px] grid place-items-center text-sm text-gray-500'>
      טוען יומן…
    </div>
  ),
})

// Action-layer minimum is 5 min; mirror it here so a fumbled resize fails
// fast without the round-trip + revert dance.
const MIN_DURATION_MS = 5 * 60 * 1000

type Props = {
  meetings: MeetingSummaryDTO[]
  needsReauth?: boolean
}

export default function CalendarView({ meetings, needsReauth = false }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [formDefaults, setFormDefaults] = useState<{ start: Date; end: Date } | null>(null)
  const [detail, setDetail] = useState<MeetingSummaryDTO | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [retryBusy, setRetryBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  // Single busy flag covers drag AND resize — they're mutually exclusive
  // gestures, and the visual treatment (dim + progress cursor) is identical.
  const [dragBusy, setDragBusy] = useState(false)
  const [, startTransition] = useTransition()

  const events: EventInput[] = useMemo(() => meetings.map(toEventInput), [meetings])

  function openNewMeeting(start?: Date, end?: Date) {
    setFormDefaults(start && end ? { start, end } : null)
    setFormOpen(true)
  }

  function handleSelect(arg: DateSelectArg) {
    openNewMeeting(arg.start, arg.end)
  }

  function handleDateClick(arg: DateClickArg) {
    // Month view returns midnight; bump to a sensible business hour. Week/day
    // returns the exact slot, which we keep as-is.
    const start = new Date(arg.date)
    if (start.getHours() === 0 && start.getMinutes() === 0) {
      start.setHours(14, 0, 0, 0)
    }
    // If the resulting time is already in the past (e.g. clicking today's
    // cell after 14:00, or clicking a past slot in week view), snap to the
    // next hour from now. Otherwise the form prefills with a past time and
    // the meeting becomes invisible the moment it's saved.
    if (start.getTime() < Date.now()) {
      const next = new Date()
      next.setMinutes(0, 0, 0)
      next.setHours(next.getHours() + 1)
      start.setTime(next.getTime())
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    openNewMeeting(start, end)
  }

  function handleEventClick(arg: EventClickArg) {
    const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
    if (meeting) setDetail(meeting)
  }

  // listUpcomingMeetings was widened in Stage 2 to include completed +
  // no_show meetings so the rep can see outcomes on the grid. These
  // handlers MUST guard against terminal-state meetings — moving a
  // completed meeting in the calendar would re-send Google invites for
  // a meeting the lead already attended AND break the audit invariant
  // that completed_at correlates with the actual start_at.
  async function handleEventDrop(arg: EventDropArg) {
    const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
    const newStart = arg.event.start
    if (!meeting || !newStart) {
      arg.revert()
      return
    }

    if (meeting.status !== 'scheduled') {
      arg.revert()
      toast('error', 'לא ניתן להזיז פגישה שכבר סומנה')
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
      toast('error', 'לא ניתן להזיז פגישה לתאריך שעבר')
      return
    }

    if (dragBusy) {
      arg.revert()
      // Silent revert would look like the calendar is broken — tell the user
      // why their drop didn't stick.
      toast('error', 'פגישה אחרת בעיצומה של עדכון. נסה שוב בעוד רגע.')
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

      // Pattern note: explicit `=== true` mirrors handleRetry / handleCancel.
      // `if (!result.ok)` doesn't narrow this union reliably here (likely a
      // server-action inference quirk under the current TS config).
      if (result.ok === true) {
        if (result.syncStatus === 'synced') {
          toast('success', 'הפגישה הועברה וסונכרנה ליומן Google')
        } else if (result.syncStatus === 'not_synced') {
          // Meeting has no google_event_id — never reached Google in the
          // first place. Be explicit so the user isn't misled into thinking
          // attendees got an updated invite.
          toast('success', 'הפגישה הועברה ב-CRM (לא מסונכרנת ליומן Google)')
        } else if (result.syncStatus === 'reauth_required') {
          toast('error', 'הפגישה הועברה ב-CRM. נדרש חיבור מחדש ליומן Google.')
        } else {
          toast('error', 'הפגישה הועברה ב-CRM. סנכרון ליומן Google נכשל.')
        }
        startTransition(() => router.refresh())
        return
      }

      // 'conflict' is the etag-mismatch path. The action wrote CRM BEFORE
      // calling Google (CRM-first), so by the time we see 412 the user's
      // change already landed locally. arg.revert() here would only revert
      // the visual — the next render with refreshed props would re-show the
      // event at the new position ("disappear" if off-screen). Keep visual
      // in sync with CRM, refresh data, and warn the user that Google's
      // copy didn't match. NOTE: with Phase 1's suspended etag enforcement
      // (see actions/calendar.ts) this branch is currently unreachable.
      if (result.reason === 'conflict') {
        toast('error', 'הפגישה הועברה ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).')
        startTransition(() => router.refresh())
        return
      }

      arg.revert()
      if (result.reason === 'not_owner') {
        toast('error', 'אינך מורשה להעביר פגישה זו')
      } else if (result.reason === 'invalid_input') {
        if (result.details === 'duration_too_short') {
          toast('error', 'משך הפגישה חייב להיות לפחות 5 דקות')
        } else {
          toast('error', 'הזמנים שהוזנו אינם תקינים')
        }
      } else {
        toast('error', 'העברת הפגישה נכשלה')
      }
    } catch (err) {
      console.warn('[calendar.drag] unexpected error', err)
      arg.revert()
      toast('error', 'אירעה שגיאה. נסה שוב.')
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
      toast('error', 'לא ניתן לשנות משך פגישה שכבר סומנה')
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
      toast('error', 'משך הפגישה חייב להיות לפחות 5 דקות')
      return
    }

    if (dragBusy) {
      arg.revert()
      toast('error', 'פגישה אחרת בעיצומה של עדכון. נסה שוב בעוד רגע.')
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

      if (result.ok === true) {
        if (result.syncStatus === 'synced') {
          toast('success', 'משך הפגישה עודכן וסונכרן ליומן Google')
        } else if (result.syncStatus === 'not_synced') {
          toast('success', 'משך הפגישה עודכן ב-CRM (לא מסונכרנת ליומן Google)')
        } else if (result.syncStatus === 'reauth_required') {
          toast('error', 'משך הפגישה עודכן ב-CRM. נדרש חיבור מחדש ליומן Google.')
        } else {
          toast('error', 'משך הפגישה עודכן ב-CRM. סנכרון ליומן Google נכשל.')
        }
        startTransition(() => router.refresh())
        return
      }

      // Same conflict-without-revert rule as drag: CRM-first means the local
      // write already landed; reverting the visual would diverge from the DB.
      if (result.reason === 'conflict') {
        toast('error', 'משך הפגישה עודכן ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).')
        startTransition(() => router.refresh())
        return
      }

      arg.revert()
      if (result.reason === 'not_owner') {
        toast('error', 'אינך מורשה לעדכן פגישה זו')
      } else if (result.reason === 'invalid_input') {
        // Server's invalid_input details: 'duration_too_short' | 'end_before_start'
        // | 'cancelled' | 'startAt' | 'endAt' | 'timezone'. The 5-min floor is
        // already enforced client-side; this fires on stale-anchor races or
        // server clock skew.
        if (result.details === 'duration_too_short') {
          toast('error', 'משך הפגישה חייב להיות לפחות 5 דקות')
        } else {
          toast('error', 'הזמנים שהוזנו אינם תקינים')
        }
      } else {
        toast('error', 'עדכון משך הפגישה נכשל')
      }
    } catch (err) {
      console.warn('[calendar.resize] unexpected error', err)
      arg.revert()
      toast('error', 'אירעה שגיאה. נסה שוב.')
    } finally {
      setDragBusy(false)
    }
  }

  async function handleRetry() {
    if (!detail || retryBusy) return
    setRetryBusy(true)
    try {
      const result = await retrySyncMeeting(detail.id)
      if (result.ok === true) {
        if (result.syncStatus === 'synced') toast('success', 'הפגישה סונכרנה')
        else if (result.syncStatus === 'reauth_required') toast('error', 'נדרש חיבור מחדש ליומן')
        else toast('error', 'הסנכרון נכשל')
      } else {
        toast('error', 'הסנכרון נכשל')
      }
      setDetail(null)
      startTransition(() => router.refresh())
    } finally {
      setRetryBusy(false)
    }
  }

  async function handleCancel() {
    if (!detail || cancelBusy) return
    setCancelBusy(true)
    try {
      const result = await cancelMeeting(detail.id)
      if (result.ok === true) {
        if (result.syncStatus === 'reauth_required') {
          toast('error', 'הפגישה בוטלה ב-CRM. נדרש חיבור מחדש ליומן.')
        } else if (result.syncStatus === 'failed') {
          toast('error', 'הפגישה בוטלה ב-CRM. מחיקה ביומן Google נכשלה.')
        } else {
          toast('success', 'הפגישה בוטלה')
        }
      } else {
        toast('error', 'ביטול הפגישה נכשל')
      }
      setDetail(null)
      startTransition(() => router.refresh())
    } finally {
      setCancelBusy(false)
    }
  }

  return (
    <div className='grid gap-4'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <h1 className='title'>פגישות</h1>
        <Btn lbl='פגישה חדשה' onClick={() => openNewMeeting()} />
      </div>

      {needsReauth && (
        <div className='rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-3 flex-wrap sm:flex-nowrap'>
          <Icon
            name='triangle-exclamation'
            type='reg'
            className='size-5 bg-amber-700 mt-0.5 shrink-0'
          />
          <div className='flex-1 min-w-0'>
            <p className='font-medium'>החיבור ליומן Google פג</p>
            <p className='text-xs mt-0.5'>פגישות חדשות לא יסונכרנו עד החיבור מחדש.</p>
          </div>
          <Btn
            lbl='חבר מחדש'
            variant='outline'
            href='/settings/integrations?section=google-calendar'
            size='small'
          />
        </div>
      )}

      <div
        className={`rounded-lg border border-gray-200 bg-white p-3 sm:p-5 shadow-sm calendar-shell${
          dragBusy ? ' calendar-shell-busy' : ''
        }`}
      >
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView='dayGridMonth'
          headerToolbar={{
            start: 'prev,next today',
            center: 'title',
            end: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          buttonText={{ today: 'היום', month: 'חודש', week: 'שבוע', day: 'יום' }}
          locale={heLocale}
          direction='rtl'
          firstDay={0}
          height='auto'
          contentHeight={680}
          stickyHeaderDates={true}
          dayMaxEvents={3}
          nowIndicator={true}
          allDaySlot={false}
          slotMinTime='07:00:00'
          slotMaxTime='22:00:00'
          slotDuration='00:30:00'
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          selectable={true}
          selectMirror={true}
          editable={true}
          eventStartEditable={true}
          eventDurationEditable={true}
          // Resize in month view would extend a meeting across day boundaries
          // (single-day meetings are dragged horizontally to span days). That
          // is almost never the user's intent for a 1-hour CRM meeting — so
          // resize is enabled only in time-grid views where the gesture
          // genuinely means "change the end time."
          views={{
            dayGridMonth: { eventDurationEditable: false },
          }}
          select={handleSelect}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          events={events}
          eventContent={renderEventContent}
        />
      </div>

      {formOpen && (
        <MeetingFormDialog
          open
          onClose={() => {
            setFormOpen(false)
            setFormDefaults(null)
          }}
          defaultStart={formDefaults?.start}
          defaultEnd={formDefaults?.end}
        />
      )}

      {detail && (
        <MeetingDetailsDialog
          meeting={detail}
          onClose={() => setDetail(null)}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onEdit={() => {
            // Hand off from details → edit. Capture the id before we close
            // details so the edit dialog has something to load.
            const id = detail.id
            setDetail(null)
            setEditingId(id)
          }}
          retrying={retryBusy}
          cancelling={cancelBusy}
        />
      )}

      {editingId !== null && (
        <MeetingEditDialog meetingId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  )
}

// Event-chip rendering (toEventInput, renderEventContent, MeetIcon, tones)
// lives in ./eventRendering — extracted in Stage 2 so the outcome-status
// modifier class (.crm-event--completed / .crm-event--no-show) has a
// focused home and CalendarView shrinks below the hard limit.
