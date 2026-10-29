/**
 * Pure helpers for lead status mutation sequencing (Wave A5).
 * Keeps stale Server Action responses from overwriting a newer per-lead change.
 */

export function isLatestStatusRequest(
  latestByLead: Map<number, number>,
  leadId: number,
  requestId: number,
): boolean {
  return latestByLead.get(leadId) === requestId
}

export function registerStatusRequest(latestByLead: Map<number, number>, leadId: number): number {
  const requestId = (latestByLead.get(leadId) ?? 0) + 1
  latestByLead.set(leadId, requestId)
  return requestId
}

export type StatusChangeOutcome =
  | { apply: false }
  | { apply: true; kind: 'rollback'; previousTab: string }
  | { apply: true; kind: 'success' }

/** Post-response decision for a status mutation (stale / rollback / success). */
export function resolveStatusChangeOutcome(args: {
  isLatest: boolean
  err: boolean
  previousTab: string
}): StatusChangeOutcome {
  if (!args.isLatest) return { apply: false }
  if (args.err) return { apply: true, kind: 'rollback', previousTab: args.previousTab }
  return { apply: true, kind: 'success' }
}

/** The Hebrew status-change announcement; the table reads `leads.table.statusUpdated` (same text) for the interface language. */
export const STATUS_UPDATED_ANNOUNCE = 'סטטוס עודכן'
