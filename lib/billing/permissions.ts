import { isMngr, Roles } from '@/types/roles'
import type { UserDb } from '@/db/auth'

/**
 * Billing permission predicates, composed from the existing role primitives in
 * types/roles.ts. This module does NOT introduce a new auth model — every
 * predicate here is a pure function over `user.role`. Lead-scoped visibility
 * remains the existing getPerms()-driven mechanism in db/filter.ts.
 *
 * Scope summary (matches the behavioral spec):
 *   - canReadBilling:   any internal agency user; visibility is then narrowed
 *                       by lead-level permissions at the data-access layer.
 *   - canDraftBilling:  every internal role. EXT is excluded by default to
 *                       match the prevailing posture for lead drafting/editing.
 *   - canIssueBilling:  managers/admins/GMs only. AGNT issuance is a future
 *                       per-agency opt-in that will land as an agencies config
 *                       column, never as a new role.
 *
 * Phase-1 reality: these predicates exist so that the eventual issuance and
 * draft server actions can call them. There is no UI consuming them yet.
 */

export function canReadBilling(_user: UserDb): boolean {
  return true
}

export function canDraftBilling(user: UserDb): boolean {
  return user.role !== Roles.EXT
}

export function canIssueBilling(user: UserDb): boolean {
  return isMngr(user.role as Roles)
}
