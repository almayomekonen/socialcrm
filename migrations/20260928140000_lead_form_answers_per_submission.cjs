/**
 * Lead form answers: one row per SUBMISSION, not per lead.
 *
 * WHY. `lead_form_answers` shipped (20260928130000) with one row per lead. But a
 * person who submits a second form — or a form whose phone/email matches an
 * existing ליד — lands on a lead that dedup returns rather than creates, and
 * those answers had nowhere to go. Keyed by the Meta leadgen id instead, every
 * submission keeps its own answers on the lead it belongs to.
 *
 * IDEMPOTENCY is preserved: the unique key moves from ("leadId") to
 * (provider, "leadgenId"), so a Meta redelivery or a retry of the SAME
 * submission still conflicts and is ignored. `leadgenId` is always written by
 * the ingest paths; Postgres treats NULLs as distinct, so a NULL never blocks.
 *
 * Reads stay fast with ("agencyId", "leadId").
 *
 * Additive in effect: no row is changed or removed.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS lead_form_answers_submission_uniq
      ON lead_form_answers (provider, "leadgenId")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS lead_form_answers_agency_lead_idx
      ON lead_form_answers ("agencyId", "leadId")`)
  await knex.raw(`DROP INDEX IF EXISTS lead_form_answers_lead_uniq`)
}

/**
 * Restoring one-row-per-lead is only possible while no lead has two
 * submissions; if one does, this fails rather than deleting answers.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS lead_form_answers_lead_uniq
      ON lead_form_answers ("leadId")`)
  await knex.raw(`DROP INDEX IF EXISTS lead_form_answers_agency_lead_idx`)
  await knex.raw(`DROP INDEX IF EXISTS lead_form_answers_submission_uniq`)
}
