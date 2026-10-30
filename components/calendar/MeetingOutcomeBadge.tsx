import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { formatLeadDate } from '@/lib/leads/leadDate'
import type { MeetingSummaryDTO } from '@/actions/calendar'

// Outcome badge using the unified semantic model. Renders nothing for
// 'scheduled' (default state). When an action timestamp is provided the badge
// appends " · DD/MM/YYYY" so the rep can tell at a glance when the outcome was
// stamped. Note: 'cancelled' is Neutral (an intentional void), not Error.
// Labels follow the interface language, by the stored `meetings.status` code;
// the date keeps the legacy Hebrew format, other languages BUSINESS_TZ.

type Outcome = 'completed' | 'no_show' | 'cancelled'

const MAP: Record<Outcome, { role: StatusRole; label: MessageKey }> = {
  completed: { role: 'success', label: 'calendar.badge.outcome.completed' },
  no_show: { role: 'neutral', label: 'calendar.badge.outcome.no_show' },
  cancelled: { role: 'neutral', label: 'calendar.badge.outcome.cancelled' },
}

type Props = {
  status: MeetingSummaryDTO['status']
  completedAt?: string | null
  noShowAt?: string | null
}

export default function MeetingOutcomeBadge({ status, completedAt, noShowAt }: Props) {
  const t = useT()
  const s = MAP[status as Outcome]
  if (!s) return null // 'scheduled' (or any non-terminal) → no badge
  const at = status === 'completed' ? completedAt : status === 'no_show' ? noShowAt : null
  return (
    <StatusBadge
      role={s.role}
      label={
        <span>
          {t(s.label)}
          {at && (
            <>
              <span className='mx-1 opacity-50'>·</span>
              <span className='tabular-nums'>{formatLeadDate(t.locale, at)}</span>
            </>
          )}
        </span>
      }
    />
  )
}
