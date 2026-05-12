import { ACTIVE_STATUSES, TERMINAL_STATUSES } from './leadStatuses'

export type FollowUpPulse =
  | 'follow-up-overdue'
  | 'follow-up-due'
  | 'no-open-task'
  | 'momentum-cooling'
  | 'stalled-early'
  | 'silent'

export type FollowUpSignals = {
  status: string | null
  daysSinceLastInteraction: number | null
  daysInCurrentStatus: number | null
  overdueTaskCount: number
  dueTodayTaskCount: number
  openTaskCount: number
  taskCompletionRate: number | null
}

export type FollowUpResult = { pulse: FollowUpPulse; label: string }

export const PULSE_LABELS: Record<FollowUpPulse, string> = {
  'follow-up-overdue': 'מעקב באיחור',
  'follow-up-due': 'מעקב להיום',
  'no-open-task': 'אין משימה פתוחה',
  'momentum-cooling': 'המעקב נחלש',
  'stalled-early': 'הסטטוס לא זז',
  silent: 'הקשר נעצר',
}

export function followUpPulse(s: FollowUpSignals): FollowUpResult | null {
  if (s.status && TERMINAL_STATUSES.has(s.status)) return null

  if (s.overdueTaskCount > 0) return result('follow-up-overdue')
  if (s.dueTodayTaskCount > 0) return result('follow-up-due')

  const isActive = s.status ? ACTIVE_STATUSES.has(s.status) : false

  if (isActive && s.openTaskCount === 0 && (s.daysInCurrentStatus ?? 0) > 2) {
    return result('no-open-task')
  }

  if (typeof s.daysSinceLastInteraction === 'number' && s.daysSinceLastInteraction >= 14 && (s.taskCompletionRate ?? 0) >= 0.5) {
    return result('momentum-cooling')
  }

  if (
    typeof s.daysInCurrentStatus === 'number' &&
    s.daysInCurrentStatus >= 7 &&
    s.daysInCurrentStatus < 14 &&
    s.status === 'בטיפול'
  ) {
    return result('stalled-early')
  }

  const longSilence =
    (typeof s.daysSinceLastInteraction === 'number' && s.daysSinceLastInteraction >= 21) ||
    (s.daysSinceLastInteraction === null && (s.daysInCurrentStatus ?? 0) >= 30)
  if (longSilence) return result('silent')

  return null
}

function result(pulse: FollowUpPulse): FollowUpResult {
  return { pulse, label: PULSE_LABELS[pulse] }
}
