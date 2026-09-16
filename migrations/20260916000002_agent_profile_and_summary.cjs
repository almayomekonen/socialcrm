/**
 * Agent setup from one description, and memory that survives a long conversation.
 *
 * `auto_response_settings.businessProfile` — the structured profile derived from
 * what the owner wrote. Derived once on save, never per customer message. The
 * owner's own text stays in `guidance` and remains the editable source of truth;
 * this column is the machine-readable form of it, so a failed derivation can
 * always be retried from the original words.
 *
 * `conversation_ai_state.summary` / `summaryThroughSequence` — the rolling
 * conversation summary. The worker reads a bounded window of recent messages;
 * past that window, anything the customer said is simply gone. The summary is
 * what carries a need, an unanswered question or a correction from message 5
 * into message 200, and `summaryThroughSequence` records how far it covers so a
 * turn knows which messages are summarised and which are still verbatim.
 *
 * Both columns are additive and nullable. An agency or conversation that never
 * populates them behaves exactly as it does today.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const addColumn = async (table, col, ddl) => {
    const has = await knex.schema.hasColumn(table, col)
    if (!has) await knex.raw(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }

  await addColumn('auto_response_settings', 'businessProfile', `"businessProfile" jsonb`)
  await addColumn('conversation_ai_state', 'summary', `summary text`)
  await addColumn(
    'conversation_ai_state',
    'summaryThroughSequence',
    `"summaryThroughSequence" integer NOT NULL DEFAULT 0`,
  )
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const dropColumn = async (table, col) => {
    const has = await knex.schema.hasColumn(table, col)
    if (has) await knex.raw(`ALTER TABLE ${table} DROP COLUMN "${col}"`)
  }

  await dropColumn('auto_response_settings', 'businessProfile')
  await dropColumn('conversation_ai_state', 'summary')
  await dropColumn('conversation_ai_state', 'summaryThroughSequence')
}
