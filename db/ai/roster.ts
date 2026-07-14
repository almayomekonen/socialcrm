import { db } from '@/config/db'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * Integration-3 — resident roster reads.
 *
 * The Tier-1 coverage sweep needs the set of relationships the runtime is
 * actually holding beliefs about (its resident World Model membership). State
 * Management (M1) does not expose distinct-subject enumeration, so these are
 * additive reads over M1's `ai_beliefs` table — M1's code and schema are
 * untouched. The roster is deliberately "relationships with resident beliefs",
 * not the production leads table, so the sweep stays decoupled from production
 * lead lifecycle and grows as shadow ingestion broadens coverage.
 */

/** Distinct lead subject ids that have resident beliefs in this agency. */
export async function listResidentLeadSubjects(scope: Scope): Promise<string[]> {
  const rows = (await db('ai_beliefs')
    .where({ agencyId: scope.agencyId, subjectType: 'lead' })
    .distinct('subjectId')) as { subjectId: unknown }[]
  return rows.map((r) => String(r.subjectId)).filter((id) => id.length > 0)
}

/** Distinct agency ids that hold any resident beliefs (for an "all" sweep). */
export async function listAgenciesWithBeliefs(): Promise<number[]> {
  const rows = (await db('ai_beliefs').distinct('agencyId')) as { agencyId: unknown }[]
  return rows
    .map((r) => Number(r.agencyId))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
}
