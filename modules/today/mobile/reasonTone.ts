/**
 * Presentation tone for a Today reason / window hint.
 *
 * Uses the existing Hebrew labels the view-model already ships — no new query,
 * no contract change. Overdue must stay distinguishable from a quiet gray
 * subtitle (the Leads list already does this with `text-error-text`).
 */

export type TodayReasonTone = 'error' | 'warning' | null

export function todayReasonTone(reason: string): TodayReasonTone {
  if (reason.includes('באיחור')) return 'error'
  if (reason === 'מעקב להיום' || reason.startsWith('ממתין')) return 'warning'
  return null
}

export function todayWindowHintTone(hint: string): TodayReasonTone {
  return hint.includes('נסגר') ? 'warning' : null
}

export function todayToneClass(tone: TodayReasonTone): { text: string; dot: string } | null {
  if (tone === 'error') return { text: 'text-error-text', dot: 'bg-error-text' }
  if (tone === 'warning') return { text: 'text-warning-text', dot: 'bg-warning-text' }
  return null
}
