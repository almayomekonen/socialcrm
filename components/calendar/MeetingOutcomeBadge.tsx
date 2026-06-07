import { formatDate } from '@/lib/dates'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import type { MeetingSummaryDTO } from '@/actions/calendar'

// Outcome badge using the unified semantic model. Renders nothing for
// 'scheduled' (default state). When an action timestamp is provided the badge
// appends " · DD/MM/YYYY" so the rep can tell at a glance when the outcome was
// stamped. Note: 'cancelled' is Neutral (an intentional void), not Error.

type Outcome = 'completed' | 'no_show' | 'cancelled'

const MAP: Record<Outcome, { role: StatusRole; label: string }> = {
  completed: { role: 'success', label: 'הושלמה' },
  no_show: { role: 'neutral', label: 'לא הגיע' },
  cancelled: { role: 'neutral', label: 'בוטלה' },
}

type Props = {
  status: MeetingSummaryDTO['status']
  completedAt?: string | null
  noShowAt?: string | null
}

export default function MeetingOutcomeBadge({ status, completedAt, noShowAt }: Props) {
  const s = MAP[status as Outcome]
  if (!s) return null // 'scheduled' (or any non-terminal) → no badge
  const at = status === 'completed' ? completedAt : status === 'no_show' ? noShowAt : null
  return (
    <StatusBadge
      role={s.role}
      label={
        <span>
          {s.label}
          {at && (
            <>
              <span className='mx-1 opacity-50'>·</span>
              <span className='tabular-nums'>{formatDate(at)}</span>
            </>
          )}
        </span>
      }
    />
  )
}
