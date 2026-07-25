'use server'

import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { requireProductAccess } from '@/lib/requireUser'
import { normalizePhone, normalizeEmail, normalizeIdNum } from '@/lib/leads/normalizeContact'
import { scoreCandidate, compareMatches, type DuplicateMatch, type NormalizedQuery } from '@/lib/leads/duplicateMatch'

export type FindDuplicateLeadsInput = {
  phone?: string | null
  secPhone?: string | null
  email?: string | null
  idNum?: string | null
  firstName?: string | null
  lastName?: string | null
  /** When editing, the current lead's id so it never flags itself. */
  excludeId?: number | null
}

const MAX_RESULTS = 3
const CANDIDATE_FETCH_LIMIT = 25

/**
 * Read-only advisory duplicate detection. Returns possible matches within the
 * caller's agency, scored by confidence. It NEVER blocks, writes, or merges —
 * the UI uses this purely to warn before a lead is created or its contact
 * details are changed. Returns [] when there is nothing to match on.
 */
export async function findDuplicateLeads(input: FindDuplicateLeadsInput): Promise<DuplicateMatch[]> {
  await requireProductAccess()
  const agencyId = await getAgencyId()

  const phones = [normalizePhone(input.phone), normalizePhone(input.secPhone)].filter((p): p is string => !!p)
  const email = normalizeEmail(input.email)
  const idNum = normalizeIdNum(input.idNum)

  // Nothing identifying entered yet — nothing to match against.
  if (phones.length === 0 && !email && !idNum) return []

  // The 9 significant digits; stored phones are often unnormalized (manual
  // entry), so we strip non-digits in SQL and match on the national suffix.
  const cores = phones.map((p) => p.slice(-9)).filter((c) => c.length === 9)
  const excludeId = input.excludeId ?? null

  const rows = await db('clients')
    .where({ agencyId })
    .modify((qb) => {
      if (excludeId) qb.whereNot('id', excludeId)
    })
    .where((b) => {
      for (const core of cores) {
        b.orWhereRaw(`regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') LIKE ?`, [`%${core}`])
        b.orWhereRaw(`regexp_replace(coalesce("secPhone", ''), '[^0-9]', '', 'g') LIKE ?`, [`%${core}`])
      }
      if (email) b.orWhereRaw('lower("email") = ?', [email])
      if (idNum) b.orWhere('idNum', idNum)
    })
    .limit(CANDIDATE_FETCH_LIMIT)
    .select('id', 'firstName', 'lastName', 'name', 'status', 'phone', 'secPhone', 'email', 'idNum')

  const query: NormalizedQuery = {
    phones,
    email,
    idNum,
    firstName: input.firstName?.trim() || null,
    lastName: input.lastName?.trim() || null,
  }

  return rows
    .map((row) => scoreCandidate(query, row))
    .filter((m): m is DuplicateMatch => m !== null)
    .sort(compareMatches)
    .slice(0, MAX_RESULTS)
}
