/**
 * The Grow standing-order (הוראת קבע) mandate id, kept alongside the
 * subscription it belongs to.
 *
 * WHY. Grow's webhook has always carried `directDebitId` — documented as
 * "קוד הוראת קבע ולא קוד עסקה", the MANDATE code and explicitly not a
 * transaction code — and the activation path read it, used it as a boolean
 * signal, and threw it away. The only Grow identifier we persisted was
 * `transactionId`, which names a single charge.
 *
 * That means today we cannot address a customer's standing order at all: not to
 * cancel it, not to reconcile it, not to correlate a later recurring charge back
 * to the subscription that mandate created. The customer who subscribed on
 * 2026-08-23 has a live mandate whose id we no longer hold.
 *
 * NULLABLE ON PURPOSE. Every existing row predates this column and there is no
 * honest backfill — the ids were discarded, and inventing one would be worse
 * than leaving it empty. A null means "we do not know this subscription's
 * mandate", which is exactly true, and callers must treat it as such rather
 * than as "no mandate exists".
 *
 * Storage only. Nothing in payment classification, ownership resolution or
 * entitlement reads this column.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS "growDirectDebitId" text`)
  // Reconciliation and cancellation both look a subscription up BY mandate id.
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS subscriptions_grow_direct_debit_id_idx
       ON subscriptions ("growDirectDebitId")
     WHERE "growDirectDebitId" IS NOT NULL`,
  )
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS subscriptions_grow_direct_debit_id_idx`)
  await knex.raw(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS "growDirectDebitId"`)
}
