/**
 * Task 13 — Contact IRE jobs.
 * Additive: allow auto_response_jobs.leadId NULL for non-personal WhatsApp
 * Contacts. Existing Lead jobs keep their leadId. FK is unchanged.
 *
 * Do not run against production until rollout is approved.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE auto_response_jobs
      ALTER COLUMN "leadId" DROP NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE auto_response_jobs
      ALTER COLUMN "leadId" SET NOT NULL
  `)
}
