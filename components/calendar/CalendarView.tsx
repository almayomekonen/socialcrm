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
  DateSelectArg,
  EventContentArg,
} from '@fullcalendar/core'
import type { DateClickArg } from '@fullcalendar/interaction'
import './calendar.css'

import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { toast } from '@/lib/toast'
import { cancelMeeting, retrySyncMeeting, type MeetingSummaryDTO } from '@/actions/calendar'
import MeetingFormDialog from './MeetingFormDialog'
import MeetingDetailsDialog from './MeetingDetailsDialog'

const FullCalendar = dynamic(() => import('@fullcalendar/react'), {
  ssr: false,
  loading: () => (
    <div className='h-[600px] grid place-items-center text-sm text-gray-500'>
      טוען יומן…
    </div>
  ),
})

type EventTone = { bg: string; bgHover: string; fg: string; accent: string }
const EVENT_TONES: Record<MeetingSummaryDTO['syncStatus'], EventTone> = {
  synced: { bg: '#eff6ff', bgHover: '#dbeafe', fg: '#1e3a8a', accent: '#3b82f6' },
  pending: { bg: '#f8fafc', bgHover: '#f1f5f9', fg: '#475569', accent: '#94a3b8' },
  failed: { bg: '#fef2f2', bgHover: '#fee2e2', fg: '#991b1b', accent: '#ef4444' },
  reauth_required: { bg: '#fffbeb', bgHover: '#fef3c7', fg: '#92400e', accent: '#f59e0b' },
}

type Props = {
  meetings: MeetingSummaryDTO[]
  needsReauth?: boolean
}

export default function CalendarView({ meetings, needsReauth = false }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [formDefaults, setFormDefaults] = useState<{ start: Date; end: Date } | null>(null)
  const [detail, setDetail] = useState<MeetingSummaryDTO | null>(null)
  const [retryBusy, setRetryBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
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
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    openNewMeeting(start, end)
  }

  function handleEventClick(arg: EventClickArg) {
    const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
    if (meeting) setDetail(meeting)
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
          <Btn lbl='חבר מחדש' variant='outline' href='/settings/calendar' size='small' />
        </div>
      )}

      <div className='rounded-lg border border-gray-200 bg-white p-3 sm:p-5 shadow-sm calendar-shell'>
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
          select={handleSelect}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
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
          retrying={retryBusy}
          cancelling={cancelBusy}
        />
      )}
    </div>
  )
}

function toEventInput(m: MeetingSummaryDTO): EventInput {
  return {
    id: String(m.id),
    title: m.title,
    start: m.startAt,
    end: m.endAt,
    extendedProps: { meeting: m },
  }
}

function renderEventContent(arg: EventContentArg) {
  const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
  if (!meeting) return null
  const tone = EVENT_TONES[meeting.syncStatus] ?? EVENT_TONES.pending
  const initial = (meeting.title?.trim()[0] ?? '?').toUpperCase()

  return (
    <div
      className='crm-event'
      style={
        {
          '--crm-event-bg': tone.bg,
          '--crm-event-bg-hover': tone.bgHover,
          '--crm-event-fg': tone.fg,
          '--crm-event-accent': tone.accent,
        } as React.CSSProperties
      }
    >
      <span className='crm-event-avatar'>{initial}</span>
      <span className='crm-event-title'>{meeting.title}</span>
      {arg.timeText && <span className='crm-event-time'>{arg.timeText}</span>}
      {meeting.meetUrl && <MeetIcon />}
    </div>
  )
}

function MeetIcon() {
  return (
    <svg
      className='crm-event-meet'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden='true'
    >
      <rect x='2' y='6' width='14' height='12' rx='2' />
      <path d='M22 6 L17 9.5 L17 14.5 L22 18 Z' />
    </svg>
  )
}
