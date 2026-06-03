import { formatDate } from '@/lib/dates'
import type { MeetingSummaryDTO } from '@/actions/calendar'

// Outcome badge, mirroring SyncStatusBadge's compact pill shape so the dialog
// header reads as one badge row. Renders NOTHING for scheduled (no badge =
// default state); pills for the three terminal outcomes. When the action
// timestamp is provided, the badge appends " · DD/MM/YYYY" so the rep can
// tell at a glance whether the outcome was stamped today or last week —
// matters because Stage 2 widened listUpcomingMeetings to include
// completed/no_show meetings on the grid.

type Outcome = 'completed' | 'no_show' | 'cancelled'

const STYLES: Record<
  Outcome,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  completed: {
    label: 'הושלמה',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  no_show: {
    label: 'לא הגיע',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
  },
  cancelled: {
    label: 'בוטלה',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
}

type Props = {
  status: MeetingSummaryDTO['status']
  completedAt?: string | null
  noShowAt?: string | null
}

export default function MeetingOutcomeBadge({ status, completedAt, noShowAt }: Props) {
  if (status === 'scheduled') return null
  const s = STYLES[status]
  const at = status === 'completed' ? completedAt : status === 'no_show' ? noShowAt : null
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text} ${s.border}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      <span>
        {s.label}
        {at && (
          <>
            <span className='mx-1 opacity-50'>·</span>
            <span className='font-variant-tabular'>{formatDate(at)}</span>
          </>
        )}
      </span>
    </span>
  )
}
