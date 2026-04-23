import type { Knex } from 'knex'
import { db } from '@/config/db'

export const QUOTA_LOCK_NAMESPACE = 12345

export async function withAgencyQuotaLock<T>(agencyId: number, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [agencyId, QUOTA_LOCK_NAMESPACE])
    return fn(trx)
  })
}
