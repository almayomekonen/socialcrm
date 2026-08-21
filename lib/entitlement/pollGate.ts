/**
 * Stop polling once the server has said the subscription does not cover this.
 *
 * The forensic audit found `/api/inbox/sync` and `/api/inbox/awareness` re-firing
 * the same `403 product-access-required` roughly every five seconds, forever,
 * behind a permanent yellow "בעיית חיבור — מנסה שוב" banner. A 403 for
 * entitlement is not a transient network fault: retrying it cannot succeed until
 * the customer renews, and the retry itself is what made a billing state look
 * like an outage.
 *
 * Module-level rather than React state on purpose: the three pollers live in
 * three different providers, and the fact they are reacting to is global to the
 * session and monotonic — access cannot come back without a page load, because
 * renewal goes through Grow and returns via a full navigation. A flag that is
 * only ever set true is the smallest thing that cannot get out of sync.
 *
 * This gates POLLING ONLY. It grants nothing, hides nothing, and is never
 * consulted for authorization — the server keeps refusing regardless.
 */

let accessDenied = false

/** Call when a polled endpoint answers 403 product-access-required. */
export function markAccessDenied(): void {
  accessDenied = true
}

/** Poll loops check this before firing another request. */
export function isAccessDenied(): boolean {
  return accessDenied
}

/** Test-only: the flag is module state and would otherwise leak across cases. */
export function __resetAccessDeniedForTests(): void {
  accessDenied = false
}
