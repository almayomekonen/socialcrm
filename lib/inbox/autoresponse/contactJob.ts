/**
 * Task 13 — Contact IRE job identity.
 *
 * An auto_response_jobs row carries `leadId = null` when it belongs to a
 * non-personal WhatsApp Contact that has no Lead yet. `conversationId` remains
 * the durable conversation identity in both cases.
 *
 * Pure on purpose: `db/autoResponseJobs` is mocked with explicit factories in
 * many suites, so a predicate living there disappears under test. Keep this
 * module free of DB access so every consumer can rely on it.
 */

/** True only for a real Lead reference. Null / 0 / NaN mean "Contact job". */
export function isPositiveLeadId(id: number | null | undefined): id is number {
  return typeof id === 'number' && Number.isFinite(id) && id > 0
}
