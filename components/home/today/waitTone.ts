import type { QualifyingState } from '@/lib/today/types'
import type { Tone } from '@/components/home/dashboard/ui'

// Wait tone per precomputed state — shared by the mission card and the leads
// table. Rendered shadcn-style: a neutral outline badge whose small icon carries
// the colour, and the badge always carries text (never colour-only).
// Red: a person is waiting / a promise is late. Amber: due today. Grey: new.
export const WAIT_STATE_TONE: Record<QualifyingState, Tone> = {
  WAITING_REPLY: 'bad',
  FOLLOWUP_OVERDUE: 'bad',
  FOLLOWUP_DUE_TODAY: 'warn',
  OVERDUE_TASK: 'warn',
  NEW_INBOUND: 'info',
  OPEN_LOOP_SLA: 'info',
}
