/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // Billing period for the annual plan. Default 'monthly' IS the backfill:
  // factually correct for every existing row (all current subscriptions were
  // 30-day purchases) — no data rewriting, no downgrade risk.
  await knex.raw(
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS "billingPeriod" text NOT NULL DEFAULT 'monthly'`,
  )
  // Purchase intent recorded at upgrade-click; consulted by the webhook's
  // period-resolution chain (rule 3).
  await knex.raw(
    `ALTER TABLE pending_upgrades ADD COLUMN IF NOT EXISTS "billingPeriod" text NOT NULL DEFAULT 'monthly'`,
  )
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE pending_upgrades DROP COLUMN IF EXISTS "billingPeriod"`)
  await knex.raw(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS "billingPeriod"`)
}
