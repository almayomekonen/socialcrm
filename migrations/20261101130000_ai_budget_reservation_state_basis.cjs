/**
 * AI budget reservations — tie the settlement STATE to its COST BASIS.
 *
 * REQUIRES REVIEW BEFORE ANY DEPLOYMENT. Local only; not applied anywhere.
 * Depends on 20261031120000_ai_budget_shadow (the table) and
 * 20261101120000_ai_budget_reservation_cost_basis (the basis columns).
 *
 * Three CHECKs:
 *
 *   ai_budget_reservations_open_unsettled            (VALIDATED)
 *     An open (`reserved`) row has no basis, no actual and no settledAt.
 *     True of every row ever written: only a settlement sets those, and it
 *     moves the row out of `reserved` in the same statement.
 *
 *   ai_budget_reservations_state_matches_basis       (VALIDATED)
 *     When a basis is present: `reconciled` is reported_usage or estimated;
 *     `unknown_cost` and `expired` are unknown; `failed` may be any (a failed
 *     request can still have billed usage). Rows with a NULL basis — settled
 *     before 20261101120000 — are not constrained: their basis was never
 *     recorded and is NOT inferred here.
 *
 *   ai_budget_reservations_settled_has_basis         (NOT VALID)
 *     Every settlement written from now on records a basis. Added NOT VALID so
 *     historical settled rows (NULL basis) are neither rejected nor
 *     reinterpreted. Postgres still enforces it on any INSERT or UPDATE — so a
 *     historical settled row cannot be updated without a basis; nothing in the
 *     application updates settled rows (every write is guarded on
 *     state = 'reserved'). Never VALIDATE it while such rows exist.
 *
 * ADDITIVE: constraints only, no data rewritten. Re-runnable: each constraint
 * is dropped IF EXISTS and re-added. Rollback drops the three constraints only.
 *
 * @param {import('knex').Knex} knex
 */
const T = 'ai_budget_reservations'
const CONSTRAINTS = [
  [
    'ai_budget_reservations_open_unsettled',
    `CHECK (state <> 'reserved' OR ("actualCostBasis" IS NULL AND "actualUsd" IS NULL AND "settledAt" IS NULL))`,
  ],
  [
    'ai_budget_reservations_state_matches_basis',
    `CHECK ("actualCostBasis" IS NULL
       OR (state = 'reconciled' AND "actualCostBasis" IN ('reported_usage','estimated'))
       OR (state IN ('unknown_cost','expired') AND "actualCostBasis" = 'unknown')
       OR state = 'failed')`,
  ],
  ['ai_budget_reservations_settled_has_basis', `CHECK (state = 'reserved' OR "actualCostBasis" IS NOT NULL) NOT VALID`],
]

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  for (const [name, check] of CONSTRAINTS) {
    await knex.raw(`ALTER TABLE ${T} DROP CONSTRAINT IF EXISTS ${name}`)
    await knex.raw(`ALTER TABLE ${T} ADD CONSTRAINT ${name} ${check}`)
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const [name] of [...CONSTRAINTS].reverse()) await knex.raw(`ALTER TABLE ${T} DROP CONSTRAINT IF EXISTS ${name}`)
}
