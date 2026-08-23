/**
 * WhatsApp Agent — Human Presence safety model (storage only).
 *
 * Additive, reversible, zero behavior change on its own. Three transient columns
 * on the EXISTING per-conversation AI lifecycle row — deliberately NOT a new
 * table and NOT a parallel presence system:
 *
 *   · the send guard already loads conversation_ai_state, so presence costs no
 *     extra query on the hot path;
 *   · presence and aiState ('human_active') must be read together and can never
 *     disagree if they live on one row;
 *   · ON DELETE CASCADE from inbox_conversations already cleans it up.
 *
 * "humanTypingUntil" is a TTL, never a latch: a browser that disconnects mid
 * keystroke stops refreshing and the conversation returns to the agent by itself.
 * "humanTypingAt" is the monotonic marker the final send authorization compares
 * against the turn epoch — it is what makes a reply generated across a typing
 * event undeliverable even after the TTL has expired.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const add = async (col, ddl) => {
    const has = await knex.schema.hasColumn('conversation_ai_state', col)
    if (!has) await knex.raw(`ALTER TABLE conversation_ai_state ADD COLUMN ${ddl}`)
  }
  await add('humanTypingUntil', `"humanTypingUntil" timestamptz`)
  await add('humanTypingAt', `"humanTypingAt" timestamptz`)
  await add('humanTypingUserId', `"humanTypingUserId" integer`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const col of ['humanTypingUntil', 'humanTypingAt', 'humanTypingUserId']) {
    const has = await knex.schema.hasColumn('conversation_ai_state', col)
    if (has) await knex.raw(`ALTER TABLE conversation_ai_state DROP COLUMN "${col}"`)
  }
}
