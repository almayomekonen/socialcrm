import type { Knex } from 'knex'
import { db } from '@/config/db'
import { CREDIT_PACK_CHARGE_KINDS, type ChargeRow, type CreditPackChargeKind } from '@/db/payments/charges'
import { packConfig, type PackKind } from '@/lib/credits/config'
import { creditPeriodKey, insertEntry } from './ledger'

/**
 * Credit-pack purchases ride the existing Grow token-charge pipeline as their
 * own `billing_charges` kinds. This file owns the two ends that differ from a
 * subscription charge:
 *
 *   createCreditPackCharge   the pending row, created by an explicit purchase.
 *                            `periodKey` = credits:<credits>:<requestKey>, so
 *                              · a double-click / resubmitted form with the same
 *                                request key resolves to the SAME row (the
 *                                existing UNIQUE ("agencyId","periodKey",attempt));
 *                              · the credit amount SOLD is frozen with the row,
 *                                whatever the config says later.
 *   grantCreditPack          the credits, inserted in the SAME transaction that
 *                            marks the charge `succeeded` — which only happens on
 *                            a Grow-confirmed payment. Keyed `charge:<group>`, so
 *                            a second success report (sync answer + reconcile,
 *                            a replayed worker) can never grant twice.
 */

const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isPurchaseRequestKey = (v: unknown): v is string => typeof v === 'string' && REQUEST_KEY.test(v)

export function packPeriodKey(credits: number, requestKey: string): string {
  return `credits:${credits}:${requestKey}`
}

/** The credits a pack charge was SOLD with, read back from its period key. */
export function creditsSold(periodKey: string): number | null {
  const m = /^credits:(\d+):/.exec(periodKey)
  return m ? Number(m[1]) : null
}

export type CreatedPackCharge = { chargeId: number; replay: boolean; status: string } | { blocked: true }

/** Namespace for the per-agency purchase lock ('PAKS'). */
const PURCHASE_LOCK = 0x50414b53
/** An undispatched purchase older than this was abandoned; it does not block a new one (and can no longer be sent). */
const OPEN_PENDING_MS = 15 * 60_000
const PACK_KINDS_LIST = CREDIT_PACK_CHARGE_KINDS as CreditPackChargeKind[]

/** A FINAL decline (expired, blocked, stolen) on a pack: Grow says stop charging this token, so packs do. */
export async function packFinalDeclineOnCard(paymentMethodId: number): Promise<boolean> {
  return !!(await db('billing_charges').where({ paymentMethodId, status: 'failed_final', errorClass: 'final' }).whereIn('kind', PACK_KINDS_LIST).first('id'))
}

export async function createCreditPackCharge(input: { agencyId: number; paymentMethodId: number; kind: PackKind; requestKey: string }): Promise<CreatedPackCharge> {
  if (!isPurchaseRequestKey(input.requestKey)) throw new Error('invalid_request_key')
  const pack = packConfig(input.kind)
  const periodKey = packPeriodKey(pack.credits, input.requestKey)
  return db.transaction(async (trx): Promise<CreatedPackCharge> => {
    await trx.raw('SELECT pg_advisory_xact_lock(?::int, ?::int)', [PURCHASE_LOCK, input.agencyId])
    const same = await trx('billing_charges').where({ agencyId: input.agencyId, periodKey, attempt: 1 }).first('id', 'status')
    if (same) return { chargeId: Number(same.id), replay: true, status: String(same.status) }
    // One open purchase per agency: a new request key must not double an unconfirmed charge.
    const open = await trx('billing_charges')
      .where({ agencyId: input.agencyId })
      .whereIn('kind', PACK_KINDS_LIST)
      .where((q) => q.whereIn('status', ['in_flight', 'unknown']).orWhere((p) => p.where('status', 'pending').where('createdAt', '>', new Date(Date.now() - OPEN_PENDING_MS))))
      .first('id')
    if (open) return { blocked: true }
    const res = await trx.raw(
    `INSERT INTO billing_charges
       (id, "groupIdentifier", "agencyId", "paymentMethodId", kind, "periodKey", attempt, "firstAttemptAt", amount, currency, "billingPeriod", status, "nextAttemptAt")
     SELECT d.id, d.id, ?, ?, ?, ?, 1, now(), ?, 'ILS', 'one_time', 'pending', now()
       FROM (SELECT nextval('billing_charges_id_seq') AS id) d
     ON CONFLICT ("agencyId", "periodKey", attempt) DO NOTHING
     RETURNING id, status`,
    [input.agencyId, input.paymentMethodId, input.kind, periodKey, pack.priceIls],
    )
    return { chargeId: Number(res.rows[0].id), replay: false, status: String(res.rows[0].status) }
  })
}

/** Inside the success transaction only. True when credits were granted by THIS call. */
export async function grantCreditPack(trx: Knex.Transaction, charge: ChargeRow): Promise<boolean> {
  const kind = charge.kind as CreditPackChargeKind
  const credits = creditsSold(charge.periodKey)
  if (credits === null || credits <= 0) throw new Error(`credit_pack_without_amount:${charge.id}`)
  return insertEntry(trx, {
    agencyId: charge.agencyId,
    entryType: 'purchase_grant',
    amountMillis: credits * 1000,
    periodKey: creditPeriodKey(Date.now()),
    idempotencyKey: `charge:${charge.groupIdentifier}`,
    sourceKind: 'billing_charge',
    sourceId: String(charge.id),
    meta: { kind, credits, amountIls: charge.amount },
  })
}

export type PackPurchaseRow = { id: number; kind: CreditPackChargeKind; credits: number | null; amount: number; status: string; createdAt: Date; succeededAt: Date | null }

export async function listCreditPackCharges(agencyId: number, limit = 20): Promise<PackPurchaseRow[]> {
  const rows = await db('billing_charges')
    .where({ agencyId })
    .whereIn('kind', CREDIT_PACK_CHARGE_KINDS as CreditPackChargeKind[])
    .orderBy('id', 'desc')
    .limit(limit)
    .select('id', 'kind', 'periodKey', 'amount', 'status', 'createdAt', 'succeededAt')
  return rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    kind: r.kind as CreditPackChargeKind,
    credits: creditsSold(String(r.periodKey)),
    amount: Number(r.amount),
    status: String(r.status),
    createdAt: new Date(r.createdAt as string),
    succeededAt: r.succeededAt ? new Date(r.succeededAt as string) : null,
  }))
}

export type PaidPackRow = { id: string; transactionId: string; createdAt: Date; pack: { kind: CreditPackChargeKind; credits: number | null; amount: number } }

/** Confirmed pack payments, shaped as rows of the charge history. A row exists only after Grow confirmed payment. */
export async function listPaidCreditPacks(agencyId: number): Promise<PaidPackRow[]> {
  const rows = await db('billing_charges')
    .where({ agencyId, status: 'succeeded' })
    .whereIn('kind', PACK_KINDS_LIST)
    .orderBy('succeededAt', 'desc')
    .select('id', 'kind', 'periodKey', 'amount', 'providerTransactionId', 'succeededAt')
  return rows.map((r: Record<string, unknown>) => ({
    id: `pack-${r.id}`,
    transactionId: String(r.providerTransactionId),
    createdAt: new Date(r.succeededAt as string),
    pack: { kind: r.kind as CreditPackChargeKind, credits: creditsSold(String(r.periodKey)), amount: Number(r.amount) },
  }))
}
