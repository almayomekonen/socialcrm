/**
 * Follow-Up Engine V1.5 — Upcoming Follow-Ups visibility layer.
 *
 * Pure shaping for the dashboard's "מעקבים קרובים" section. The query fetches
 * one extra row (limit + 1) so we can tell the user the list is truncated
 * instead of silently dropping follow-ups.
 */

export type UpcomingFollowUp = {
  id: number
  name: string
  phone: string | null
  status: string
  nextFollowUpAt: string | Date
  followUpNote: string | null
}

/** Split the (limit + 1) fetched rows into the visible page and a has-more flag. */
export function splitUpcoming<T>(rows: T[], limit: number): { visible: T[]; hasMore: boolean } {
  return { visible: rows.slice(0, limit), hasMore: rows.length > limit }
}
