/**
 * Owner decision (2026-09-15): a retryable decline is retried at +1, +3 and +7
 * days from the FIRST attempt of the period; a success at any point unlocks.
 *
 * Deliberately absent: timing for reconciling a charge whose outcome is unknown
 * (timeout / lost response). That depends on how Grow answers
 * getTokenTransactionsByExternalIdentifiers and on its duplicate-identifier
 * behaviour — Gate B evidence, not assumptions.
 */

export const RETRY_OFFSETS_DAYS = [1, 3, 7] as const
export const MAX_ATTEMPTS = 1 + RETRY_OFFSETS_DAYS.length

const DAY_MS = 86_400_000

export function nextRetryAt(firstAttemptAt: Date, failedAttempt: number): Date | null {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) return null
  const offset = RETRY_OFFSETS_DAYS[failedAttempt - 1]
  if (offset === undefined) return null
  return new Date(firstAttemptAt.getTime() + offset * DAY_MS)
}
