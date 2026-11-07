/**
 * Additive: `auto_response_jobs."sendStartedAt"` — set, by the job's lease owner,
 * immediately before the WhatsApp send. A job that still carries it when its
 * lease expires, or when a failure would otherwise put it back in the queue,
 * may already be on the customer's phone, so it is parked
 * (`skipped` / `send_outcome_unknown`) and handed to a person instead of being
 * sent again. Nullable, no default, no backfill: existing rows are unaffected.
 *
 * Apply to Production BEFORE merging the code that reads it (merging deploys).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE auto_response_jobs ADD COLUMN IF NOT EXISTS "sendStartedAt" timestamptz NULL`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE auto_response_jobs DROP COLUMN IF EXISTS "sendStartedAt"`)
}
