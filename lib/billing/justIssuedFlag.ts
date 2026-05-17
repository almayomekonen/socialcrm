/**
 * One-shot "this invoice was just issued in this tab" flag.
 *
 * Replaces the previous `?send=1` URL coupling between the new-invoice
 * editor and the issued-view send banner. URL flags leak through the app
 * (refresh, back/forward, shared links) and require defensive strip-on-
 * mount logic in the consumer. sessionStorage is explicit, per-tab, and
 * dies with the tab.
 *
 * Contract:
 *   - `markInvoiceJustIssued(id)` is called once at the moment of issuance,
 *     immediately before the editor navigates to the issued view.
 *   - `consumeJustIssuedFlag(id)` is called once on mount of the issued
 *     view. It returns true exactly once per mark; subsequent calls (e.g.
 *     a manual refresh) return false. This makes the banner one-shot.
 *
 * SSR safety: both functions no-op when `window` is undefined.
 */

const KEY_PREFIX = 'billing.justIssued.'

function keyFor(invoiceId: number): string {
  return `${KEY_PREFIX}${invoiceId}`
}

export function markInvoiceJustIssued(invoiceId: number): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(keyFor(invoiceId), '1')
  } catch {
    // sessionStorage can throw in private-browsing modes / quota cases.
    // The banner is a polish layer — silent degradation is the right
    // behavior. The user can still send via the hero button.
  }
}

export function consumeJustIssuedFlag(invoiceId: number): boolean {
  if (typeof window === 'undefined') return false
  try {
    const k = keyFor(invoiceId)
    const present = sessionStorage.getItem(k) === '1'
    if (present) sessionStorage.removeItem(k)
    return present
  } catch {
    return false
  }
}
