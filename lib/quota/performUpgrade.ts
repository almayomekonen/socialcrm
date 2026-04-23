import type { Knex } from 'knex'
import { db } from '@/config/db'

export type PerformUpgradeResult = { success: true } | { error: 'not_found' }

export async function performAgencyUpgrade(
  agencyId: number,
  reason: string,
  q: Knex = db,
): Promise<PerformUpgradeResult> {
  const exists = await q('agencies').where({ id: agencyId }).first()
  if (!exists) return { error: 'not_found' }

  await q('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: reason })
  await q('clients').where({ agencyId, overQuota: true }).update({ overQuota: false })

  return { success: true }
}
