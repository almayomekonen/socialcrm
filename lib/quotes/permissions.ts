import { isAdmin, Roles } from '@/types/roles'
import type { UserDb } from '@/db/auth'

/**
 * Quotation permission predicates, composed from the existing role primitives in
 * types/roles.ts. This module introduces NO new auth model — every predicate is
 * a pure function over `user.role`, exactly as `lib/billing/permissions.ts` is.
 * Lead-scoped visibility remains the existing getPerms()-driven mechanism at the
 * data-access layer; these answer only "may this role act at all".
 *
 * Deliberately SEPARATE from the billing predicates, and deliberately NOT the
 * same set:
 *
 *   canSendQuote     ⊃  canIssueBilling
 *
 * A נציג may quote but may not invoice. Quoting is a sales act — it commits the
 * business to a price it is willing to accept, which is what a rep is for.
 * Issuing an invoice is an accounting act with legal numbering and tax
 * consequences, and it stays managers-only through `canIssueBilling`, which this
 * file does not touch.
 *
 * That asymmetry IS the sales/accounting boundary, stated in the permission
 * model rather than only in prose.
 */

/**
 * Any internal agency user may read quotes; visibility is then narrowed by
 * lead-level permissions at the data-access layer. Mirrors `canReadBilling`.
 */
export function canReadQuotes(_user: UserDb): boolean {
  return true
}

/**
 * Creating and editing a draft. EXT (external partner) is excluded, matching the
 * prevailing posture for lead drafting and `canDraftBilling`.
 */
export function canDraftQuote(user: UserDb): boolean {
  return user.role !== Roles.EXT
}

/**
 * Marking a quote ready and sending it to the customer.
 *
 * The same set as drafting rather than a narrower one: a rep who may put a price
 * in front of a lead is the same person who may hand it over, and requiring a
 * manager for the second half would leave quotes sitting unsent — the exact
 * failure the product exists to prevent. Converting an accepted quote into an
 * invoice remains gated by `canIssueBilling`.
 */
export function canSendQuote(user: UserDb): boolean {
  return user.role !== Roles.EXT
}

/**
 * Creating, editing and archiving the agency's quote TEMPLATES — its price list.
 *
 * Deliberately narrower than `canDraftQuote`, and the distinction is the point:
 *
 *   canDraftQuote            USING a price on a lead        — every internal role
 *   canManageQuoteTemplates  DECIDING what the prices are   — admins only
 *
 * A rep quoting ₪4,900 is doing their job; a rep changing what ₪4,900 means for
 * everyone is changing business policy. That is agency configuration, and it
 * matches every other configuration surface in the product — task templates,
 * automations and automation templates are all admin-only, and this page lives
 * beside them under the same `(admin_settings)` route group.
 *
 * Composed from the existing `isAdmin` primitive, in the existing predicate
 * module. No new authorization model: if the business later wants managers to
 * edit prices, this one line becomes `isMngr` and both the route and the Server
 * Actions follow, because both call this function rather than testing a role.
 */
export function canManageQuoteTemplates(user: UserDb): boolean {
  return isAdmin(user.role as Roles)
}
