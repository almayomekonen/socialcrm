import { waMeHref } from '@/modules/leads/whatsapp'

/**
 * THE CONTACT PLAN — one decision, shared by every surface that offers to
 * contact a lead, so the phone list, the lead detail and the conversation
 * composer can never disagree about what is possible.
 *
 * WHY IT IS SYNCHRONOUS AND PURE. The native-WhatsApp branch has to render as a
 * real `<a href>` that the browser follows on the FIRST tap. An earlier
 * implementation resolved the same question with an awaited server action and
 * then called `window.open`, by which point the transient user activation was
 * spent and mobile silently suppressed the popup — the first tap did nothing at
 * all. Anything this function needs must therefore already be on the client at
 * render time. It performs no I/O and returns no promise, and that is a
 * constraint, not an accident.
 *
 * `whatsappConnected === undefined` means "the caller does not know", and it
 * deliberately resolves to `in_app` — the pre-existing behaviour. Surfaces that
 * have not been threaded the workspace connection state keep working exactly as
 * they did, so adopting this helper is incremental rather than a flag day.
 */

export type LeadContactPlan =
  /** Route through the in-app conversation (existing `openLeadWhatsappInInbox`). */
  | { kind: 'in_app' }
  /** Hand off to WhatsApp itself. `href` is ready to put on an anchor. */
  | { kind: 'native'; href: string }
  /** Nothing usable to offer. Today the only such reason is an unusable number. */
  | { kind: 'blocked'; reason: 'no_phone' }

export function resolveLeadContactPlan(input: {
  phone: string | null | undefined
  /** Workspace-level WhatsApp connection. `undefined` = unknown, keep existing behaviour. */
  whatsappConnected?: boolean
}): LeadContactPlan {
  // Unknown or connected: the in-app path owns this lead. The connected case is
  // untouched on purpose — it is the one path in the product that already works.
  if (input.whatsappConnected !== false) return { kind: 'in_app' }

  // Not connected. `waMeHref` returns null for anything it cannot normalise to a
  // dialable number, which is exactly the `no_phone` case: we must never render
  // an anchor to a malformed wa.me URL.
  const href = waMeHref(input.phone)
  return href ? { kind: 'native', href } : { kind: 'blocked', reason: 'no_phone' }
}

/**
 * The composer's fallback, for the two states where WhatsApp IS connected but
 * Meta's rules leave no in-app way to write: the customer has never messaged
 * (`window_unknown`), or the 24h window closed with no approved template
 * (`window_closed_no_template`). Both are real Meta constraints on the API, and
 * neither constrains the rep's own phone.
 *
 * Returns null when there is no usable number, so callers render nothing rather
 * than a dead control.
 */
export function nativeWhatsappFallbackHref(customerPhone: string | null | undefined): string | null {
  return waMeHref(customerPhone)
}
