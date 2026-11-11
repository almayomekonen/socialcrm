/**
 * The lead an owner chose in a WhatsApp request, kept with the message that
 * chose it (lib/waAssistant/leadChoice.ts).
 *
 * `wa_assistant_jobs."leadChoice"` holds ids only, never names or numbers:
 *   { "options": [12, 7, 31] }  the exact list we showed, in the order shown;
 *   { "leadId": 12 }            the lead this request is now about.
 * So "1" means the first lead of the list the owner actually saw, and later
 * answers in the same request keep that lead instead of asking again.
 *
 * Additive and nullable: existing rows mean "nothing chosen", exactly as before.
 * Reversible.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE wa_assistant_jobs ADD COLUMN IF NOT EXISTS "leadChoice" jsonb NULL`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE wa_assistant_jobs DROP COLUMN IF EXISTS "leadChoice"`)
}
