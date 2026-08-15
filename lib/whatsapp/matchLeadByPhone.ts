import { db } from '@/config/db'
import { phoneCore } from '@/lib/leads/normalizeContact'

export type PhoneMatchedClient = {
  id: number
  name: string
  status: string | null
  phone: string | null
}

/**
 * Agency-scoped phoneCore match against clients.phone / clients.secPhone.
 *
 * Matches any client row in the agency (open Lead or closed/won) so a later
 * WhatsApp from a Facebook/Instagram Lead's phone links instead of duplicating.
 * Multiple matches → caller must not guess.
 */
export async function findClientsByPhoneCore(
  agencyId: number,
  waId: string,
): Promise<PhoneMatchedClient[]> {
  const core = phoneCore(waId)
  if (!core || !Number.isFinite(agencyId) || agencyId <= 0) return []

  const rows = (await db('clients')
    .where('agencyId', agencyId)
    .andWhere(function () {
      this.whereRaw(`RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = ?`, [core]).orWhereRaw(
        `RIGHT(REGEXP_REPLACE(COALESCE("secPhone", ''), '[^0-9]', '', 'g'), 9) = ?`,
        [core],
      )
    })
    .select('id', 'name', 'firstName', 'lastName', 'status', 'phone')
    .limit(20)) as Array<{
    id: number
    name: string | null
    firstName: string | null
    lastName: string | null
    status: string | null
    phone: string | null
  }>

  return rows.map((r) => ({
    id: Number(r.id),
    name: (r.name || [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || null) ?? `ליד #${r.id}`,
    status: r.status ?? null,
    phone: r.phone ?? null,
  }))
}
