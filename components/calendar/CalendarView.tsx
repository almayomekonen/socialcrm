'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventClickArg, DateSelectArg } from '@fullcalendar/core'
import type { DateClickArg } from '@fullcalendar/interaction'
import './calendar.css'

import { Btn } from '@/lib/btns/Btn'
import { proToast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import type { MeetingSummaryDTO } from '@/actions/calendar'
import MeetingFormDialog from './MeetingFormDialog'
import MeetingDetailsDialog from './MeetingDetailsDialog'
import MeetingEditDialog from './MeetingEditDialog'
import { toEventInput, renderEventContent } from './eventRendering'
import { useMeetingReschedule } from './hooks/useMeetingReschedule'
import { useMeetingSyncActions } from './hooks/useMeetingSyncActions'
import CalendarReauthBanner from './CalendarReauthBanner'
import { fullCalendarLocale } from './fullCalendarLocale'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

const FullCalendar = dynamic(() => import('@fullcalendar/react'), {
  ssr: false,
  loading: () => <CalendarLoading />,
})

function CalendarLoading() {
  const t = useT()
  return (
    <div className='h-[600px] grid place-items-center text-sm text-gray-500'>
      {t('calendar.page.loading')}
    </div>
  )
}

type Props = {
  meetings: MeetingSummaryDTO[]
  needsReauth?: boolean
}

export default function CalendarView({ meetings, needsReauth = false }: Props) {
  const t = useT()
  /** Entitlement from the shared context — the same answer the server gives. */
  const expired = useAccessDenied()
  /**
   * Existing meetings stay real and readable; only the actions that create or
   * change one are answered with the billing prompt. Each names the capability
   * renewal restores rather than reporting a failure.
   */
  const proPrompt = (title: string, body: string, source: string) => proToast({ title, body, source })
  const promptCreate = () => proPrompt(t('calendar.pro.create.title'), t('calendar.pro.create.body'), 'calendar_create')
  const promptMove = () => proPrompt(t('calendar.pro.move.title'), t('calendar.pro.move.body'), 'calendar_move')
  const [formOpen, setFormOpen] = useState(false)
  const [formDefaults, setFormDefaults] = useState<{ start: Date; end: Date } | null>(null)
  const [detail, setDetail] = useState<MeetingSummaryDTO | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  // Drag / resize (with the shared busy flag) and the details dialog's
  // retry / cancel live in hooks; the entitlement answer stays here.
  const { dragBusy, handleEventDrop, handleEventResize } = useMeetingReschedule({ expired, promptMove })
  const { retryBusy, cancelBusy, handleRetry, handleCancel } = useMeetingSyncActions({
    expired,
    proPrompt,
    detail,
    setDetail,
  })

  const events: EventInput[] = useMemo(() => meetings.map(toEventInput), [meetings])

  function openNewMeeting(start?: Date, end?: Date) {
    // The affordance stays visible on purpose: the customer sees what the
    // product does, and learns the boundary only when they reach for it.
    if (expired) return promptCreate()
    setFormDefaults(start && end ? { start, end } : null)
    setFormOpen(true)
  }

  function handleSelect(arg: DateSelectArg) {
    if (expired) return promptCreate()
    openNewMeeting(arg.start, arg.end)
  }

  function handleDateClick(arg: DateClickArg) {
    if (expired) return promptCreate()
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

  return (
    <div className='grid gap-4'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <h1 className='title'>{t('calendar.page.heading')}</h1>
        {/*
          The affordance stays exactly as it is for every customer. Calendar is
          a working CRM surface after a subscription lapses, not a locked page:
          the meetings are all readable and nothing is greyed out. The Pro
          boundary is met on the way INTO a paid action, where the handler
          answers with the billing prompt, so the customer discovers it by
          reaching for something rather than by reading a banner they did not
          ask for.
        */}
        <Btn lbl={t('calendar.page.newMeeting')} onClick={() => openNewMeeting()} />
      </div>


      {needsReauth && <CalendarReauthBanner />}

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
          buttonText={{
            today: t('calendar.page.grid.today'),
            month: t('calendar.page.grid.month'),
            week: t('calendar.page.grid.week'),
            day: t('calendar.page.grid.day'),
          }}
          locale={fullCalendarLocale(t.locale)}
          direction={dirFor(t.locale)}
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
