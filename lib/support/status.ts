import type { SupportAuthorKind, SupportStatus } from './vocabulary'

/**
 * Status is DERIVED from who last replied.
 *
 * The customer never manages a workflow — they write, and the state follows.
 * That is the whole point: a support surface that asks its reader to pick a
 * status is an enterprise helpdesk form wearing a friendly label.
 *
 * The platform owner can override any of the four explicitly; that path calls
 * the same resolvedAtFor() below, so the clock rules cannot diverge between the
 * derived and the manual routes.
 */

const AFTER_CUSTOMER_REPLY: Record<SupportStatus, SupportStatus> = {
  open: 'open',
  // NOT 'open'. A customer adding detail to a request someone is actively
  // working on must not knock it back and erase that fact.
  in_progress: 'in_progress',
  waiting_for_customer: 'in_progress',
  // Replying to a closed request reopens it. This is why there is no separate
  // "reopen" control for the customer to hunt for: if they still have the
  // problem, saying so is the reopen.
  resolved: 'open',
}

export function nextStatusAfterReply(
  current: SupportStatus,
  authorKind: SupportAuthorKind,
): SupportStatus {
  if (authorKind === 'support') return 'waiting_for_customer'
  if (authorKind === 'system') return current
  return AFTER_CUSTOMER_REPLY[current] ?? current
}

/**
 * The one rule that keeps `support_requests_resolved_requires_timestamp`
 * satisfiable AND stops a reopened request from advertising a resolution that
 * was undone: any transition OUT of `resolved` nulls the timestamp, in the same
 * UPDATE that changes the status.
 */
export function resolvedAtFor(
  nextStatus: SupportStatus,
  currentResolvedAt: Date | null,
  now: Date,
): Date | null {
  if (nextStatus !== 'resolved') return null
  return currentResolvedAt ?? now
}
