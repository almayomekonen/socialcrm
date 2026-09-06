import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'

/**
 * System / server follow-up write — NO product-session authorization.
 *
 * The exact counterpart of `createSystemTask`, and it exists for the same
 * reason. The user-facing boundary is the `setLeadFollowUp` server action, which
 * calls `requireProductAccess()` and re-derives identity from the request
 * cookie. The Agent has already resolved authority — that is what `ActionActor`
 * is — and re-deriving it inside an executor would mean the actor that was
 * authorised and the actor that writes could differ, and would break every
 * session-less path outright.
 *
 * THE GATE IS NOT DROPPED, IT IS PASSED IN. `applyFollowUp` scopes its update by
 * agency and, for non-admins, by the lead owners the rep may touch. This
 * reproduces that WHERE clause exactly from a caller-supplied scope rather than
 * from a session. Losing the second half would let a rep set a follow-up on a
 * colleague's lead — an agency-scoped write that is still not an authorised one.
 *
 * NEVER import this from client/UI code. It performs no session check by
 * design; the only safe callers are server paths that have already established
 * who is acting, and the Action Runtime is one.
 *
 * SETTING REPLACES. One date and one optional note per lead — the Follow-Up
 * Engine's own semantics, unchanged here. `lastActivityAt` is stamped because
 * setting a follow-up is real lead work, exactly as the product action does.
 */
export async function setLeadFollowUpSystem({
  leadId,
  agencyId,
  role,
  gotPermIds,
  at,
  note,
  nowMs,
}: {
  leadId: number
  /** Authenticated agency. Never a caller or model value. */
  agencyId: number
  /** Authenticated role, deciding whether the owner restriction applies. */
  role: string
  /** Lead owners this actor may write to. Applied for non-admins only. */
  gotPermIds: number[]
  /** The follow-up instant. The caller owns the business-day boundary. */
  at: Date
  note?: string | null
  nowMs?: number
}): Promise<{ updated: boolean }> {
  const now = new Date(nowMs ?? Date.now())
  const query = db('clients').where({ id: leadId, agencyId })
  // Mirrors actions/leadFollowUp.ts — the same restriction, from a scope rather
  // than from a cookie.
  if (!isAdmin(role as Parameters<typeof isAdmin>[0])) query.whereIn('userId', gotPermIds)

  const rows = await query
    .update({ nextFollowUpAt: at, followUpNote: note?.trim() || null, lastActivityAt: now, updatedAt: now })
    .returning('id')

  return { updated: Array.isArray(rows) && rows.length > 0 }
}
