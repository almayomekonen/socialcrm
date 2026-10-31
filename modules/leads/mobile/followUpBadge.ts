import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Follow-up state as a badge — computed SERVER-SIDE against an injected clock.
 *
 * `dayStartMs` is the business-day boundary from `lib/today/time.ts`
 * (BUSINESS_TZ, DST-aware), NOT `new Date().setHours(0,0,0,0)` in the browser.
 * That distinction is the whole of architecture-rules.md §11: Vercel runs UTC
 * and the rep's phone runs Asia/Jerusalem, and a boundary derived on both sides
 * produces a hydration mismatch that is fatal in the production build.
 */

/**
 * `tone` is the semantic level; `className` is the filled-pill treatment.
 *
 * Both exist because the two surfaces present the same fact at different
 * weights: the lead DETAIL screen shows one lead, so a filled pill is
 * proportionate, while the LIST shows thirty and a column of filled red pills
 * reads as decoration and stops meaning "urgent" at all. The list uses `tone` to
 * draw a dot plus coloured text instead. One computation, two weights — not two
 * rules that can disagree.
 */
export type FollowUpBadge = { label: string; className: string; tone: 'error' | 'warning' }

export function followUpBadge(
  nextFollowUpAt: string | null,
  nowMs: number,
  dayStartMs: number,
  /** The label's language (Hebrew by default — the same words as before). */
  locale: UiLocale = 'he',
): FollowUpBadge | null {
  const t = translatorFor(locale)
  if (!nextFollowUpAt) return null
  const at = new Date(nextFollowUpAt).getTime()
  if (Number.isNaN(at)) return null

  if (at < dayStartMs) {
    return { label: t('leads.mobile.followUpBadge.overdue'), className: 'border-error-border bg-error-bg text-error-text', tone: 'error' }
  }
  if (at <= nowMs) {
    return { label: t('leads.mobile.followUpBadge.today'), className: 'border-warning-border bg-warning-bg text-warning-text', tone: 'warning' }
  }
  const dayEnd = dayStartMs + 24 * 60 * 60 * 1000
  if (at < dayEnd) {
    return { label: t('leads.mobile.followUpBadge.today'), className: 'border-warning-border bg-warning-bg text-warning-text', tone: 'warning' }
  }
  return null
}
