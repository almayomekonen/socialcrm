import { getAgencyId } from '@/db/agencies'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { scopedLeads, type Scope } from '@/db/briefing'

// Today brief — FACTS ONLY. The set of in-scope leads touched today (lastActivityAt
// on/after the business-day start passed in from lib/today/time). The handled ⟂
// qualifying difference (INV-12) is computed in lib/today/progress, not here.

/** Builder only (SQL-testable). `dayStartMs` is the business-day start from the domain layer. */
export function touchedTodayQuery(agencyId: number, plan: string, scope: Scope, dayStartMs: number) {
  return scopedLeads(agencyId, plan, scope).where('clients.lastActivityAt', '>=', new Date(dayStartMs)).select('clients.id')
}

export async function getTouchedTodayIds(scope: Scope, dayStartMs: number): Promise<number[]> {
  const agencyId = scope.agencyId ?? (await getAgencyId())
  const plan = await getEffectiveLeadPlan(agencyId)
  const rows = (await touchedTodayQuery(agencyId, plan, scope, dayStartMs)) as { id: number }[]
  return rows.map((r) => Number(r.id))
}
