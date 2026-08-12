/**
 * Follow-up state as a badge — computed SERVER-SIDE against an injected clock.
 *
 * `dayStartMs` is the business-day boundary from `lib/today/time.ts`
 * (BUSINESS_TZ, DST-aware), NOT `new Date().setHours(0,0,0,0)` in the browser.
 * That distinction is the whole of architecture-rules.md §11: Vercel runs UTC
 * and the rep's phone runs Asia/Jerusalem, and a boundary derived on both sides
 * produces a hydration mismatch that is fatal in the production build.
 */

export type FollowUpBadge = { label: string; className: string }

export function followUpBadge(
  nextFollowUpAt: string | null,
  nowMs: number,
  dayStartMs: number,
): FollowUpBadge | null {
  if (!nextFollowUpAt) return null
  const at = new Date(nextFollowUpAt).getTime()
  if (Number.isNaN(at)) return null

  if (at < dayStartMs) {
    return { label: 'מעקב באיחור', className: 'border-error-border bg-error-bg text-error-text' }
  }
  if (at <= nowMs) {
    return { label: 'מעקב להיום', className: 'border-warning-border bg-warning-bg text-warning-text' }
  }
  const dayEnd = dayStartMs + 24 * 60 * 60 * 1000
  if (at < dayEnd) {
    return { label: 'מעקב להיום', className: 'border-warning-border bg-warning-bg text-warning-text' }
  }
  return null
}
