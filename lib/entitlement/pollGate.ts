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
 * session.
 *
 * IT IS NO LONGER MONOTONIC, and the original reasoning for that is now wrong.
 * "Access cannot come back without a page load, because renewal returns via a
 * full navigation" holds only for the tab that paid. A customer with the CRM
 * open in one tab who renews in another comes back to a tab that latched
 * `true` and stays silently unpollable until it is reloaded — a paying customer
 * looking at a lapsed product. {@link clearAccessDenied} exists for exactly
 * that recovery.
 *
 * THE RESET IS NOT A TIMER. It is called only where the SERVER has positively
 * confirmed active entitlement (`getEntitlementStatus().active`, which refuses
 * to be satisfied by a fail-open read). Clearing on a schedule, on a retry, or
 * on optimism would restore the polling storm this flag was added to stop.
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

/**
 * Clear the latch after the server has POSITIVELY confirmed entitlement is
 * active. Never call this on a guess, a timer, or a client-side assumption:
 * the only sanctioned input is `getEntitlementStatus().active`.
 */
export function clearAccessDenied(): void {
  accessDenied = false
}

/** Test-only: the flag is module state and would otherwise leak across cases. */
export function __resetAccessDeniedForTests(): void {
  accessDenied = false
}
