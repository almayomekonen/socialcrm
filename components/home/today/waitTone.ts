import type { QualifyingState } from '@/lib/today/types'

// Wait-chip tone per precomputed state — shared by the mission card and the list.
// Red: a person is waiting / a promise is late. Amber: due today. Brand: new.
export const WAIT_TONE: Record<QualifyingState, string> = {
  WAITING_REPLY: 'bg-error-bg text-error-text',
  FOLLOWUP_OVERDUE: 'bg-error-bg text-error-text',
  FOLLOWUP_DUE_TODAY: 'bg-warning-bg text-warning-text',
  OVERDUE_TASK: 'bg-warning-bg text-warning-text',
  NEW_INBOUND: 'bg-primary-tint text-primary-text',
  OPEN_LOOP_SLA: 'bg-primary-tint text-primary-text',
}
