import type { EventInput, EventContentArg } from '@fullcalendar/core'
import type { MeetingSummaryDTO } from '@/actions/calendar'

// Sync-status tones (existing visual vocabulary). Outcome state (completed /
// no_show) layers on top of these via the .crm-event--completed and
// .crm-event--no-show modifier classes in calendar.css — sync state and
// outcome state are orthogonal: a synced + completed meeting wears both
// indicators, a failed-sync + completed meeting also does.
type EventTone = { bg: string; bgHover: string; fg: string; accent: string }
const EVENT_TONES: Record<MeetingSummaryDTO['syncStatus'], EventTone> = {
  synced: { bg: '#eff6ff', bgHover: '#dbeafe', fg: '#1e3a8a', accent: '#3b82f6' },
  pending: { bg: '#f8fafc', bgHover: '#f1f5f9', fg: '#475569', accent: '#94a3b8' },
  failed: { bg: '#fef2f2', bgHover: '#fee2e2', fg: '#991b1b', accent: '#ef4444' },
  reauth_required: { bg: '#fffbeb', bgHover: '#fef3c7', fg: '#92400e', accent: '#f59e0b' },
}

export function toEventInput(m: MeetingSummaryDTO): EventInput {
  return {
    id: String(m.id),
    title: m.title,
    start: m.startAt,
    end: m.endAt,
    extendedProps: { meeting: m },
  }
}

export function renderEventContent(arg: EventContentArg) {
  const meeting = arg.event.extendedProps.meeting as MeetingSummaryDTO | undefined
  if (!meeting) return null
  const tone = EVENT_TONES[meeting.syncStatus] ?? EVENT_TONES.pending
  const initial = (meeting.title?.trim()[0] ?? '?').toUpperCase()

  // Outcome modifier: layers on top of the sync-status tone. completed /
  // no_show dim the chip and apply outcome-specific visual treatment (see
  // calendar.css). Scheduled stays at full strength.
  const outcomeClass =
    meeting.status === 'completed'
      ? ' crm-event--completed'
      : meeting.status === 'no_show'
        ? ' crm-event--no-show'
        : ''

  return (
    <div
      className={`crm-event${outcomeClass}`}
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
