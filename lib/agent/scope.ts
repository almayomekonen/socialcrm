import 'server-only'
import { requireProductAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import type { AgentScope } from './types'

/**
 * The ONLY place the Agent's authority is established.
 *
 * Every field is derived from the session — never from a request body, never
 * from a model argument, never from a tool input. Each tool closes over the
 * result and no tool may widen it; that is what makes agency isolation
 * structural rather than a prompt instruction.
 *
 * It reuses the product's existing primitives unchanged:
 *   · requireProductAccess — session identity + the canonical product-access
 *     boundary, so an expired trial cannot reach the Agent at all
 *   · getPerms             — the same permission set every scoped lead read uses
 *   · getEffectiveLeadPlan — the plan the quota/scoping layer applies
 *   · getFirstName         — one resolved display name, as the dashboard does
 *
 * `firstName` comes from getFirstName, NOT a `user.firstName` field: the session
 * user (UserDb) has no such property — `users.name` is a generated column that
 * is NULL whenever lastName is null, which is exactly the case getFirstName
 * exists to recover.
 */
export async function resolveAgentScope(): Promise<AgentScope> {
  const user = await requireProductAccess()
  const { gotPermIds } = await getPerms(user)
  const plan = await getEffectiveLeadPlan(user.agencyId)

  return {
    agencyId: user.agencyId,
    userId: user.id,
    role: user.role,
    gotPermIds,
    plan,
    firstName: getFirstName(user),
  }
}
