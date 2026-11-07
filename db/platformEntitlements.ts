import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * The founder entitlement (`founder_unlimited_usage`): unlimited legitimate
 * product usage for ONE verified user of ONE agency, granted by a reviewed data
 * change in platform_entitlements (migration 20261109120000).
 *
 *   - BOTH agencyId and userId must match an active (unrevoked) grant. Another
 *     user of the same agency, or the same user id in another agency, gets nothing.
 *   - NO cache: every check reads the table, so a revocation applies to the next
 *     job / reminder transaction. Only a job already running finishes under the
 *     state it started with (bounded by the worker's 60 s maximum duration).
 *   - FAIL CLOSED: any read error means "not a founder", and normal limits apply.
 *
 * What the entitlement waives is COMMERCIAL only (quotas, spend caps, product
 * access). Security, consent, opt-out, identity, approvals, Meta restrictions,
 * emergency switches and every delivery gate never read it.
 */

export const FOUNDER_ENTITLEMENT = 'founder_unlimited_usage'

export async function founderEntitlement(agencyId: number | null | undefined, userId: number | null | undefined, q: Knex | Knex.Transaction = db): Promise<boolean> {
  if (!Number.isSafeInteger(agencyId) || !Number.isSafeInteger(userId) || (agencyId as number) <= 0 || (userId as number) <= 0) return false
  const read = (x: Knex | Knex.Transaction) =>
    x('platform_entitlements').where({ agencyId, userId, entitlement: FOUNDER_ENTITLEMENT }).whereNull('revokedAt').first('id')
  try {
    // Inside a transaction the read runs in a SAVEPOINT: a failure rolls back only
    // the savepoint, so the caller's transaction continues under normal limits
    // instead of being aborted (Postgres aborts a transaction on any error).
    const row = (q as Knex.Transaction).isTransaction ? await (q as Knex.Transaction).transaction((sp) => read(sp)) : await read(q)
    return !!row
  } catch (err) {
    console.error('[founder-entitlement] read failed; normal limits apply', { agencyId, name: (err as Error)?.name ?? null })
    return false
  }
}
