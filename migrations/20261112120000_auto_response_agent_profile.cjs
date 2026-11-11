/**
 * The owner's structured agent profile for the conversational auto-response:
 * custom greeting, persona, preferred tone, FAQ and topics that need a person.
 *
 * `auto_response_settings."agentProfile"` — jsonb, nullable. Written only by the
 * settings action (actions/autoResponse/updateSettings.ts) from the owner's own
 * words, validated by lib/inbox/autoresponse/conversational/agentProfile.ts, and
 * read only when the agency is on IRE_CONVERSATIONAL_AGENCY_IDS.
 *
 * Additive and nullable. Every existing row stays NULL, and an agency that never
 * fills it behaves exactly as it does today. `guidance`, `agentInstructions` and
 * `businessProfile` are untouched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('auto_response_settings', 'agentProfile')
  if (!has) await knex.raw(`ALTER TABLE auto_response_settings ADD COLUMN "agentProfile" jsonb`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('auto_response_settings', 'agentProfile')
  if (has) await knex.raw(`ALTER TABLE auto_response_settings DROP COLUMN "agentProfile"`)
}
