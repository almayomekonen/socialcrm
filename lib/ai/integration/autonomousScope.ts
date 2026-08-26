import 'server-only'
import { buildRecipientContext, resolveRecipients } from '@/db/notifications/recipients'
import { resolveAiAccess } from '@/lib/ai/access'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import { db } from '@/config/db'
import type { AgentScope } from '@/lib/agent/types'

/**
 * Autonomous operator scope — who the runtime is acting AS when nobody asked.
 *
 * `lib/agent/scope.ts` establishes authority from a session: `requireProductAccess`
 * → `getPerms` → `getEffectiveLeadPlan`. A proactive investigation has no session,
 * and manufacturing one would be exactly the "sessionless permission fan-out" this
 * design forbids. So the operator is not invented — it is RESOLVED, by the same
 * pure function the notification engine already uses to decide who receives a
 * notification about this lead.
 *
 * THE INVARIANT THIS BUYS. `resolveRecipients` with the `handler_or_admin` rule
 * decides both who may read the evidence and who will later receive the insight.
 * One function, two uses, so it follows structurally that *an autonomous insight
 * can never be delivered to someone who could not have seen the evidence beneath
 * it.* Re-deriving either side would break that the first time the two drifted.
 *
 * Note what `handler_or_admin` already gets right and is NOT reinterpreted here:
 * it falls back to admins only when a lead is genuinely unassigned, and returns
 * NOBODY when the lead is missing from the context — an absent lead means it no
 * longer exists or was never in this agency, and acting on behalf of every admin
 * for a lead nobody can open would be the wrong kind of safe.
 *
 * AGENCY ISOLATION IS STORAGE-ENFORCED. `agencyId` originates from the leased
 * `signal_jobs` row, whose CHECK already asserts the column equals the agency
 * inside the stored signal's own scope. It never comes from a request body, a
 * session, a tool input, or a model argument. This module accepts it as a
 * parameter precisely because its only caller reads it from that row.
 *
 * ENTITLEMENT WITHOUT A SESSION. `resolveAiAccess(agencyId)` is the existing
 * sessionless product-access boundary and already fails open on a read error, so
 * a transient database blip never silently stops a paying customer's proactive
 * work. `requireProductAccess()` is never called: there is no session to require.
 */

export type AutonomousScopeResult =
  | { ok: true; scope: AgentScope }
  | { ok: false; reason: 'no_operator' | 'not_entitled' | 'operator_unreadable' }

/** Minimal user shape the perms/plan/name primitives need. Read, never trusted from input. */
type OperatorRow = { id: number; agencyId: number; role: string; firstName: string | null; lastName: string | null }

/**
 * Resolve the operator for one lead, then build the scope from the SAME
 * primitives the session path uses. Read-only; performs no write.
 */
export async function resolveAutonomousScope(input: { agencyId: number; leadId: number }): Promise<AutonomousScopeResult> {
  const { agencyId, leadId } = input

  const access = await resolveAiAccess(agencyId)
  if (access.allowed === false) return { ok: false, reason: 'not_entitled' }

  // The recipient rule, applied by the notification engine's own function. The
  // context is loaded for exactly this one (agency, lead) pair.
  const context = await buildRecipientContext({ leadPairs: [{ agencyId, leadId }], agencyIds: [agencyId] })
  const recipients = resolveRecipients({ rule: 'handler_or_admin', agencyId, leadId, context })
  if (recipients.length === 0) return { ok: false, reason: 'no_operator' }

  // Deterministic choice among equals: the lowest user id. `handler_or_admin`
  // returns exactly one user when a handler exists; the admin fallback may return
  // several, and picking by id keeps the same lead resolving to the same operator
  // across ticks rather than rotating with row order.
  const operatorUserId = [...recipients].sort((a, z) => a - z)[0]!

  const row = (await db('users')
    .select('id', 'agencyId', 'role', 'firstName', 'lastName')
    .where({ id: operatorUserId, agencyId })
    .first()) as OperatorRow | undefined

  // Tenancy re-checked at read: a user id that does not belong to this agency
  // cannot become a scope, even if the recipient context somehow offered one.
  if (!row) return { ok: false, reason: 'operator_unreadable' }

  // AN ADMIN OPERATOR NEVER CALLS getPerms. This is a correctness fix, not an
  // optimisation.
  //
  // `getPerms`'s admin branch calls `getUsersAndTeams()` -> `getUsers()` ->
  // `getAgencyId()` -> `getUser()`, and `getUser()` returns null on this path:
  // there is no request session behind an autonomous investigation. `user.agencyId`
  // then threw inside P5, BEFORE any spend reservation existed, and the worker's
  // retry ladder dead-lettered the observation on the third attempt. Four
  // production `sla.open_loop` jobs died that way on agency 103, whose single
  // handler is an admin.
  //
  // The substitution is EXACT, not an approximation. That branch returns
  // `gotPermIds: []` unconditionally; this function destructures `gotPermIds` and
  // discards every other field it builds; and `scopedLeads` skips the `gotPermIds`
  // filter entirely for admins (`if (!isAdmin(...)) q.whereIn(...)`), so an empty
  // array is what "unrestricted" already meant — see AgentScope.gotPermIds. The
  // resolved scope is byte-identical; only the session dependency is gone.
  //
  // `db/filter.ts` is permissions code and is deliberately NOT touched.
  const [gotPermIds, plan] = await Promise.all([
    isAdmin(row.role as AgentScope['role'])
      ? Promise.resolve<number[]>([])
      : getPerms(row as never).then((p: { gotPermIds: number[] }) => p.gotPermIds),
    getEffectiveLeadPlan(agencyId),
  ])

  return {
    ok: true,
    scope: {
      agencyId,
      userId: row.id,
      role: row.role as AgentScope['role'],
      gotPermIds,
      plan,
      firstName: getFirstName(row as never),
    },
  }
}
