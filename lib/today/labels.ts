// Today brief — deterministic Hebrew labels for qualifying states. Pure. The
// display string is a fixed function of the state, computed server-side and put in
// the DTO so the UI never maps state → copy itself. Terminology per the product
// rules (ליד / מעקב; never לקוח / סוכן).

import type { QualifyingState } from './types'

const REASON: Record<QualifyingState, string> = {
  WAITING_REPLY: 'ממתין לתשובה שלך',
  FOLLOWUP_OVERDUE: 'מעקב באיחור',
  FOLLOWUP_DUE_TODAY: 'מעקב להיום',
  NEW_INBOUND: 'ליד חדש',
  OVERDUE_TASK: 'משימה באיחור',
  OPEN_LOOP_SLA: 'ממתין לטיפול',
}

export function reasonFor(state: QualifyingState): string {
  return REASON[state]
}
