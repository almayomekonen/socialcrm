import type { Knex } from 'knex'
import { db } from '@/config/db'
import { encryptSecret } from '@/lib/crypto/secrets'
import type { BillingPeriod } from '@/lib/pricing'
import type { PaymentMethodRow } from './paymentMethods'
import { exactGrowIdentifier } from '@/lib/payments/grow/identifiers'

/**
 * Charge attempts: claim, lease recovery and terminal transitions. Every
 * transition is guarded on the current status, so a replayed worker step is a
 * no-op. The dispatch step itself lives in chargeDispatch.ts.
 */

export type ChargeKind = 'trial_conversion' | 'renewal'
export type ChargeStatus = 'pending' | 'in_flight' | 'succeeded' | 'failed_final' | 'failed_retryable' | 'unknown' | 'cancelled'

export type ChargeRow = {
  id: number
  agencyId: number
  paymentMethodId: number
  kind: ChargeKind
  periodKey: string
  groupIdentifier: number
  attempt: number
  firstAttemptAt: Date
  amount: number
  billingPeriod: BillingPeriod
  status: ChargeStatus
  nextAttemptAt: Date
  dispatchedAt: Date | null
  updatedAt: Date
}

export type AttemptContext = { charge: ChargeRow; method: PaymentMethodRow; cardToken: string }
export type PaidCharge = { transactionId: string; transactionToken: string | null; asmachta: string | null; statusCode: string }
export type FailedCharge = {
  status: 'failed_final' | 'failed_retryable'
  errorClass: string
  errorId: number | null
  errorMessage: string
  statusCode: string | null
}

export const CHARGES_TABLE = 'billing_charges'
const OPEN_FOR_RESULT = ['in_flight', 'unknown']

export function mapCharge(r: Record<string, any>): ChargeRow {
  return {
    id: exactGrowIdentifier(r.id),
    agencyId: Number(r.agencyId),
    paymentMethodId: Number(r.paymentMethodId),
    kind: r.kind,
    periodKey: r.periodKey,
    groupIdentifier: exactGrowIdentifier(r.groupIdentifier),
    attempt: Number(r.attempt),
    firstAttemptAt: new Date(r.firstAttemptAt),
    amount: Number(r.amount),
    billingPeriod: r.billingPeriod,
    status: r.status,
    nextAttemptAt: new Date(r.nextAttemptAt),
    dispatchedAt: r.dispatchedAt ? new Date(r.dispatchedAt) : null,
    updatedAt: new Date(r.updatedAt),
  }
}

/** Lease claim; SKIP LOCKED lets concurrent passes never take the same row. */
export async function claimDueCharges(workerId: string, limit: number, agencyId: number | null = null): Promise<ChargeRow[]> {
  const res = await db.raw(
    `UPDATE billing_charges c
        SET status = 'in_flight', "lockedAt" = now(), "lockedBy" = ?, "updatedAt" = now()
      WHERE c.id IN (
        SELECT id FROM billing_charges
         WHERE status = 'pending' AND "nextAttemptAt" <= now()
           AND (?::integer IS NULL OR "agencyId" = ?::integer)
         ORDER BY "nextAttemptAt" ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT ?
      )
      RETURNING c.*`,
    [workerId, agencyId, agencyId, limit],
  )
  return (res.rows ?? []).map(mapCharge)
}

/**
 * An expired lease is resolved by whether the request could have left:
 * never dispatched → back to pending; dispatched → UNKNOWN (may have charged).
 */
export async function reclaimStaleInFlightCharges(leaseMs: number): Promise<{ requeued: number; unknown: number }> {
  const cutoff = new Date(Date.now() - leaseMs)
  const requeued = await db(CHARGES_TABLE)
    .where({ status: 'in_flight' })
    .whereNull('dispatchedAt')
    .where('lockedAt', '<', cutoff)
    .update({ status: 'pending', lockedAt: null, lockedBy: null, updatedAt: new Date() })
  const unknown = await db(CHARGES_TABLE)
    .where({ status: 'in_flight' })
    .whereNotNull('dispatchedAt')
    .where('lockedAt', '<', cutoff)
    .update({ status: 'unknown', errorClass: 'lease_expired', lockedAt: null, lockedBy: null, updatedAt: new Date() })
  return { requeued, unknown }
}

export async function listUnknownCharges(limit: number): Promise<ChargeRow[]> {
  return (await db(CHARGES_TABLE).where({ status: 'unknown' }).orderBy('updatedAt', 'asc').limit(limit)).map(mapCharge)
}

export async function markChargeSucceeded(q: Knex, chargeId: number, paid: PaidCharge): Promise<boolean> {
  const n = await q(CHARGES_TABLE)
    .where({ id: chargeId })
    .whereIn('status', OPEN_FOR_RESULT)
    .whereNotNull('dispatchedAt')
    .update({
      status: 'succeeded',
      providerTransactionId: paid.transactionId,
      providerTransactionToken: paid.transactionToken ? encryptSecret(paid.transactionToken) : null,
      providerAsmachta: paid.asmachta,
      providerStatusCode: paid.statusCode,
      succeededAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
  return n === 1
}

export async function markChargeFailed(q: Knex, chargeId: number, f: FailedCharge): Promise<void> {
  await q(CHARGES_TABLE)
    .where({ id: chargeId })
    .whereIn('status', OPEN_FOR_RESULT)
    .update({
      status: f.status,
      errorClass: f.errorClass,
      errorId: f.errorId,
      errorMessage: f.errorMessage.slice(0, 500),
      providerStatusCode: f.statusCode,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
}

/** Only a DISPATCHED attempt can have an unknown outcome. */
export async function markChargeUnknown(chargeId: number, reason: string, detail: { errorId?: number | null; errorMessage?: string; statusCode?: string | null } = {}): Promise<void> {
  await db(CHARGES_TABLE)
    .where({ id: chargeId, status: 'in_flight' })
    .whereNotNull('dispatchedAt')
    .update({
      status: 'unknown',
      errorClass: reason,
      errorId: detail.errorId ?? null,
      errorMessage: detail.errorMessage ? detail.errorMessage.slice(0, 500) : null,
      providerStatusCode: detail.statusCode ?? null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
}

/** Gives back a claim that was never dispatched (e.g. dispatch is disabled). */
export async function releaseUndispatchedClaim(chargeId: number): Promise<boolean> {
  const n = await db(CHARGES_TABLE)
    .where({ id: chargeId, status: 'in_flight' })
    .whereNull('dispatchedAt')
    .update({ status: 'pending', lockedAt: null, lockedBy: null, updatedAt: new Date() })
  return n === 1
}

/** attempt + 1 for the same period and group, unless the period is already paid or still open. */
export async function insertNextAttempt(q: Knex, previous: ChargeRow, nextAttemptAt: Date, paymentMethodId?: number): Promise<number | null> {
  const res = await q.raw(
    `INSERT INTO billing_charges
       ("agencyId", "paymentMethodId", kind, "periodKey", "groupIdentifier", attempt, "firstAttemptAt", amount, currency, "billingPeriod", status, "nextAttemptAt")
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'ILS', ?, 'pending', ?
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_charges
         WHERE "agencyId" = ? AND "periodKey" = ? AND status IN ('succeeded','pending','in_flight','unknown')
      )
     ON CONFLICT ("agencyId", "periodKey", attempt) DO NOTHING
     RETURNING id`,
    [
      previous.agencyId,
      paymentMethodId ?? previous.paymentMethodId,
      previous.kind,
      previous.periodKey,
      previous.groupIdentifier,
      previous.attempt + 1,
      previous.firstAttemptAt,
      previous.amount,
      previous.billingPeriod,
      nextAttemptAt,
      previous.agencyId,
      previous.periodKey,
    ],
  )
  return res.rows?.[0] ? Number(res.rows[0].id) : null
}
