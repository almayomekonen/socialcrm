/**
 * AI budget reservations — keep the COST BASIS of every settlement.
 *
 * REQUIRES REVIEW BEFORE ANY DEPLOYMENT. Local only; not applied anywhere.
 *
 * Before this, a settled reservation stored only `actualUsd`, so an estimated
 * actual (cache writes priced at the worst rate, an unreported billing tier, a
 * documented alias, …) could not be told apart from a cost priced entirely from
 * provider-reported usage. These columns record how each settled amount was
 * established, and link the reservation to the ledger rows it covers without
 * depending on the ledger being enabled:
 *
 *   actualCostBasis       reported_usage | estimated | unknown. NULL only for
 *                         rows that are still open, or that were settled before
 *                         this migration (their basis was never recorded and
 *                         is NOT backfilled — it is genuinely unknown).
 *   actualCostNote        the pricing reason codes (comma-separated).
 *   actualPriceVersion    the price table the actual was priced with.
 *   estimatePriceVersion  the price table the reservation estimate used
 *                         (NULL for an unbounded, policy-reserve estimate).
 *   responseModels        the provider-reported model(s) of the settled request(s).
 *   invocationId          the ledger's invocation id (ai_usage_events.invocationId).
 *   stepIndexFrom,        the ledger rows this reservation covers:
 *   stepCount             stepIndex in [stepIndexFrom, stepIndexFrom + stepCount).
 *                         A router attempt also shares its callId with its row.
 *
 * Invariant (CHECK): a settlement whose basis is `unknown` carries no actual
 * amount, and a known basis always carries one — unknown is never stored as a
 * number, and a number is never stored without its basis.
 *
 * ADDITIVE: nullable columns, one CHECK, one partial index. No data rewritten.
 * Re-runnable: every step is IF [NOT] EXISTS.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ai_budget_reservations
      ADD COLUMN IF NOT EXISTS "actualCostBasis" text NULL
        CHECK ("actualCostBasis" IN ('reported_usage','estimated','unknown')),
      ADD COLUMN IF NOT EXISTS "actualCostNote" text NULL,
      ADD COLUMN IF NOT EXISTS "actualPriceVersion" text NULL,
      ADD COLUMN IF NOT EXISTS "estimatePriceVersion" text NULL,
      ADD COLUMN IF NOT EXISTS "responseModels" text[] NULL,
      ADD COLUMN IF NOT EXISTS "invocationId" text NULL,
      ADD COLUMN IF NOT EXISTS "stepIndexFrom" integer NULL CHECK ("stepIndexFrom" IS NULL OR "stepIndexFrom" >= 0),
      ADD COLUMN IF NOT EXISTS "stepCount" integer NULL CHECK ("stepCount" IS NULL OR "stepCount" >= 0)
  `)
  await knex.raw(`ALTER TABLE ai_budget_reservations DROP CONSTRAINT IF EXISTS ai_budget_reservations_basis_matches_actual`)
  await knex.raw(`
    ALTER TABLE ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_basis_matches_actual
      CHECK ("actualCostBasis" IS NULL OR (("actualCostBasis" = 'unknown') = ("actualUsd" IS NULL)))
  `)
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS ai_budget_reservations_invocation_idx ON ai_budget_reservations ("invocationId") WHERE "invocationId" IS NOT NULL`,
  )
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS ai_budget_reservations_invocation_idx`)
  await knex.raw(`ALTER TABLE ai_budget_reservations DROP CONSTRAINT IF EXISTS ai_budget_reservations_basis_matches_actual`)
  await knex.raw(`
    ALTER TABLE ai_budget_reservations
      DROP COLUMN IF EXISTS "stepCount",
      DROP COLUMN IF EXISTS "stepIndexFrom",
      DROP COLUMN IF EXISTS "invocationId",
      DROP COLUMN IF EXISTS "responseModels",
      DROP COLUMN IF EXISTS "estimatePriceVersion",
      DROP COLUMN IF EXISTS "actualPriceVersion",
      DROP COLUMN IF EXISTS "actualCostNote",
      DROP COLUMN IF EXISTS "actualCostBasis"
  `)
}
