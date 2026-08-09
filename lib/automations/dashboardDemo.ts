import { LEAD_SOURCES, type SourceKey } from '@/lib/leadSources'

/**
 * Display data for the automation workspace.
 *
 * WHAT IS REAL AND WHAT IS NOT, stated plainly:
 *
 *   REAL, computed from props
 *     · activeCount, successes, failures — read off each automation's counts
 *
 *   PLACEHOLDER, pending a query
 *     · handled   — activity rows inside the overnight window
 *     · sources   — activity grouped by the lead's source
 *     · waiting   — leads with no reply inside the window
 *
 * EVERY PLACEHOLDER IS A METRIC THE PRODUCT CAN GENUINELY COMPUTE from data it
 * already records. That is the line: a stand-in for a real measurement is
 * scaffolding; a number the product could never derive — money at risk, a
 * conversion multiple — is a claim, and claims do not ship (Care Charter Law 1).
 *
 * Replacing this file with real queries needs no component change; the shapes
 * below are the contract.
 */

export type SourceSlice = { key: SourceKey; count: number }

export type DashboardDisplay = {
  /** Leads handled while the operator was away. */
  handled: number
  /** Per-source volume. */
  sources: SourceSlice[]
  /** Leads still waiting for a reply — the AI insight's subject. */
  waiting: number
}

export const DASHBOARD_DEMO: DashboardDisplay = {
  handled: 12,
  sources: [
    { key: LEAD_SOURCES.whatsapp.key, count: 28 },
    { key: LEAD_SOURCES.facebook.key, count: 11 },
    { key: LEAD_SOURCES.instagram.key, count: 5 },
    { key: LEAD_SOURCES.website.key, count: 3 },
  ],
  waiting: 21,
}

/**
 * The statement names the ABSENCE, not the window — "while you were away" lands
 * where "in the last 12 hours" does not. Returned whole, because the hero reads
 * as one sentence rather than a figure with a caption.
 */
export function heroStatement(handled: number, hour: number): string {
  if (hour < 11) return `SocialCRM טיפלה ב-${handled} פניות בזמן שישנתם`
  if (hour >= 18) return `SocialCRM טיפלה ב-${handled} פניות מאז שיצאתם`
  return `SocialCRM טיפלה ב-${handled} פניות היום`
}

/**
 * Minutes of manual handling avoided. An ESTIMATE, not a measurement — so the
 * basis is printed beneath it in the UI rather than hidden. A figure whose
 * assumption is visible is honest; the same figure presented as fact is not.
 */
export const MINUTES_SAVED_PER_RUN = 3

export function timeSaved(runs: number): { value: string; basis: string } {
  const mins = runs * MINUTES_SAVED_PER_RUN
  const value = mins >= 60 ? `${Math.round((mins / 60) * 10) / 10} שעות` : `${mins} דקות`
  return { value, basis: `לפי ${MINUTES_SAVED_PER_RUN} דקות טיפול ידני לפנייה` }
}
