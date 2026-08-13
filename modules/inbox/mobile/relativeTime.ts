/**
 * Server-side relative time for the mobile conversation list.
 *
 * Computed on the SERVER against an injected `nowMs` and shipped as a string,
 * so no row reads a clock in the browser — the same rule the lead cards follow
 * (architecture-rules.md §11). Pure and trivially testable.
 *
 * Deliberately coarse: a conversation list needs "how stale is this", not a
 * precise duration. Anything past a week shows a date instead of a countdown.
 */
export function relativeTimeHe(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const diffMs = nowMs - then
  if (diffMs < 0) return 'עכשיו'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'עכשיו'
  if (minutes === 1) return 'לפני דקה'
  if (minutes < 60) return `לפני ${minutes} דקות`

  const hours = Math.floor(minutes / 60)
  if (hours === 1) return 'לפני שעה'
  if (hours < 24) return `לפני ${hours} שעות`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'אתמול'
  if (days < 7) return `לפני ${days} ימים`

  // Past a week a duration stops being useful; show the date.
  const d = new Date(then)
  return `${d.getDate()}.${d.getMonth() + 1}`
}
