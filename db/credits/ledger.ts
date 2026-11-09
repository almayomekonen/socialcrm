import type { Knex } from 'knex'
import { billingMonth } from '@/lib/reminders/delivery/period'
import { BUSINESS_TZ } from '@/lib/today/constants'
import { computeBalance, type LedgerTotal, type WalletBalance } from '@/lib/credits/balance'

/**
 * agency_credit_ledger: append-only, agency-scoped, one row per grant / debit /
 * refund. Every writer goes through `insertEntry`, whose ON CONFLICT on
 * ("agencyId", "idempotencyKey") is the ONLY duplicate protection the
 * callers need: a replayed cron tick, a duplicate job, a second payment callback
 * or a retried debit inserts nothing.
 *
 * ONE balance per agency; `sourceKind` and `costMicros` keep the internal detail.
 * It is AGENCY-scoped. A user id is recorded for attribution only; a new
 * user in the same agency draws from the same balance.
 */

export const LEDGER = 'agency_credit_ledger'

export type EntryType = 'purchase_grant' | 'debit' | 'refund' | 'exempt_debit'
export type SourceKind = 'billing_charge' | 'agent_request'

export type LedgerEntry = {
  agencyId: number
  entryType: EntryType
  amountMillis: number
  periodKey: string
  idempotencyKey: string
  sourceKind: SourceKind
  sourceId: string
  userId?: number | null
  enforced?: boolean
  costMicros?: number | null
  meta?: Record<string, unknown>
}

/** "2026-11": the business month (Asia/Jerusalem) an entry counts in. */
export function creditPeriodKey(ms: number): string {
  return billingMonth(ms, BUSINESS_TZ).periodStart.slice(0, 7)
}

/** True when THIS call inserted the row; false when the key already existed. */
export async function insertEntry(q: Knex | Knex.Transaction, e: LedgerEntry): Promise<boolean> {
  const rows = await q(LEDGER)
    .insert({
      agencyId: e.agencyId,
      entryType: e.entryType,
      amountMillis: e.amountMillis,
      periodKey: e.periodKey,
      idempotencyKey: e.idempotencyKey,
      sourceKind: e.sourceKind,
      sourceId: e.sourceId,
      userId: e.userId ?? null,
      enforced: e.enforced ?? false,
      costMicros: e.costMicros ?? null,
      meta: JSON.stringify(e.meta ?? {}),
    })
    .onConflict(['agencyId', 'idempotencyKey'])
    .ignore()
    .returning('id')
  return rows.length > 0
}

/** Namespace for the two-key advisory lock ('CRED'); the second key is the agency. */
const LOCK_NAMESPACE = 0x43524544

/**
 * Serializes balance checks and debits of ONE agency balance for the rest of the
 * transaction. Taken after any reminder/recipient row locks, never before, so it
 * cannot invert the reminder lock order.
 */
export async function lockWallet(trx: Knex.Transaction, agencyId: number): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(?::int, ?::int)', [LOCK_NAMESPACE, agencyId])
}

export async function walletTotals(q: Knex | Knex.Transaction, agencyId: number): Promise<LedgerTotal[]> {
  const rows = (await q(LEDGER)
    .where({ agencyId })
    .groupBy('periodKey', 'entryType')
    .select('periodKey', 'entryType')
    .sum({ sumMillis: 'amountMillis' })
    .count({ count: '*' })) as { periodKey: string; entryType: string; sumMillis: string | number; count: string | number }[]
  return rows.map((r) => ({ periodKey: r.periodKey, entryType: r.entryType, sumMillis: Number(r.sumMillis), count: Number(r.count) }))
}

export async function walletBalance(q: Knex | Knex.Transaction, agencyId: number, periodKey: string): Promise<WalletBalance> {
  return computeBalance(await walletTotals(q, agencyId), periodKey)
}
