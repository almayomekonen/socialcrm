import { isAdmin, type Roles } from '@/types/roles'

/**
 * Who may see a support request, as two pure predicates.
 *
 * THE AGENCY CHECK IS FIRST AND UNCONDITIONAL in both. A workspace ADMIN is an
 * admin of THEIR OWN agency — role can only ever widen visibility inside the
 * tenant, never across one. Cross-tenant reading is a PLATFORM-OWNER capability
 * and lives behind isPlatformOwner(), never here. These two authority systems
 * are deliberately separate and must never be conflated.
 *
 * Pure by design: no session, no database, no I/O. The action layer supplies
 * both arguments, which is what makes these testable without a database — the
 * repo's DB-backed harness does not currently run.
 */

export type SupportViewer = { id: number; role: Roles; agencyId: number }
export type SupportRequestOwnership = { agencyId: number; createdByUserId: number | null }

export function canViewSupportRequest(
  viewer: SupportViewer,
  row: SupportRequestOwnership,
): boolean {
  if (!viewer || !row) return false

  // Tenant first, always. Nothing below can widen past this line.
  if (viewer.agencyId !== row.agencyId) return false

  // An orphaned request — its author was hard-deleted from `users`. Handled
  // EXPLICITLY rather than relying on SQL three-valued logic making
  // `"createdByUserId" = 5` false for NULL: correct there today, but a future
  // COALESCE or an index-driven rewrite would quietly change it, and
  // strictNullChecks:false will not catch that. Nobody inherits a departed
  // colleague's private support conversations.
  if (row.createdByUserId == null) return isAdmin(viewer.role)

  return row.createdByUserId === viewer.id || isAdmin(viewer.role)
}

/** Identical to viewing in V1. Separate so the two can diverge without a rewrite. */
export function canReplyToSupportRequest(
  viewer: SupportViewer,
  row: SupportRequestOwnership,
): boolean {
  return canViewSupportRequest(viewer, row)
}

/**
 * Decided HERE — from the session's role — and passed into the domain, so
 * `db/support/requests.ts` stays session-free and a future worker cannot widen
 * visibility by forgetting a role check it never knew existed.
 */
export function visibilityScopeFor(viewer: SupportViewer): 'own' | 'agency' {
  return isAdmin(viewer.role) ? 'agency' : 'own'
}
