/**
 * Auto Response — separate the three kinds of text an owner can write.
 *
 * Until now one column (`guidance`) carried "what this business is" while
 * `fixedBody` carried "the literal message to send", and a single textarea in
 * the UI swapped between them. Owners could not tell which of the two very
 * different jobs their text was doing, and there was nowhere to say HOW the
 * agent should converse as distinct from WHAT the business is.
 *
 * This adds the third field. Additive and nullable:
 *   · guidance          — business information (unchanged; existing rows keep it)
 *   · agentInstructions — how the agent should converse for this business (new)
 *   · fixedBody         — the literal outgoing message (unchanged)
 *
 * No existing value is read, rewritten or migrated. An agency that never fills
 * the new column behaves exactly as it does today.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('auto_response_settings', 'agentInstructions')
  if (!has) {
    await knex.raw(`ALTER TABLE auto_response_settings ADD COLUMN "agentInstructions" text`)
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('auto_response_settings', 'agentInstructions')
  if (has) {
    await knex.raw(`ALTER TABLE auto_response_settings DROP COLUMN "agentInstructions"`)
  }
}
