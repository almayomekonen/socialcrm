import { db } from '@/config/db'

/**
 * Worker-side fact readers over existing tables (read-only — the engine never
 * writes to clients/agencies/users). Facts feed the Phase 1 laws and the
 * variable resolution; the lead's display name is snapshotted onto activity
 * rows so history survives lead deletion (migration plan §3.3).
 */

export type LeadFacts =
  | {
      exists: true
      email: string | null
      currentStatus: string | null
      firstName: string | null
      displayName: string | null
      handlerId: number | null
    }
  | { exists: false }

export function getLeadFactsQuery(agencyId: number, leadId: number) {
  return db('clients')
    .select('id', 'email', 'status', 'firstName', 'lastName', 'handlerId')
    .where({ id: leadId, agencyId })
    .first()
}

export async function getLeadFacts(agencyId: number, leadId: number): Promise<LeadFacts> {
  const row = (await getLeadFactsQuery(agencyId, leadId)) as
    | { email: string | null; status: string | null; firstName: string | null; lastName: string | null; handlerId: number | null }
    | undefined
  if (!row) return { exists: false }
  const displayName = [row.firstName, row.lastName].filter(Boolean).join(' ') || null
  return {
    exists: true,
    email: row.email ?? null,
    currentStatus: row.status ?? null,
    firstName: row.firstName ?? null,
    displayName,
    handlerId: row.handlerId ?? null,
  }
}

export async function getAgencyName(agencyId: number): Promise<string | null> {
  const row = (await db('agencies').select('name').where({ id: agencyId }).first()) as { name: string | null } | undefined
  return row?.name ?? null
}

export async function getRepName(userId: number | null): Promise<string | null> {
  if (!userId) return null
  const row = (await db('users').select('name').where({ id: userId }).first()) as { name: string | null } | undefined
  return row?.name ?? null
}
