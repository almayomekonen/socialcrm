/**
 * Resumable progress for a history delivery (Wave 2A.2g.1, finding F-1).
 *
 * WHY A COLUMN IS REQUIRED. A Meta history chunk carries an undocumented number
 * of messages, and each imported message costs its own transaction. Before this,
 * the worker's time budget was checked only BEFORE claiming a delivery, so one
 * large chunk ran unbounded past the route's maxDuration, was killed, and its
 * lease expired. The retry then re-processed the chunk from the beginning — and
 * because a duplicate still costs a full round-trip, every attempt after the
 * first could spend its entire budget re-doing work and make no forward
 * progress, reaching maxAttempts and dying with the chunk never imported.
 *
 * The fix needs one number per delivery: how many of its messages are already
 * durably persisted. No existing column carries that meaning — `messagesSeen`
 * counts parser-level skips too, and `progress` is Meta's own percentage, a fact
 * about the archive that must not be overwritten with our bookkeeping.
 *
 * `cursor` is an offset into the delivery's messages in PAYLOAD ORDER — threads
 * in order, messages in order, exactly as `parseHistoryValue` returns them from
 * the stored raw payload. That order is deterministic for a given payload, which
 * is what makes the offset meaningful across processes.
 *
 * It is only ever advanced AFTER the messages it covers are committed, so a
 * crash can re-do work but can never skip it. Message-level
 * `(channel, externalId)` dedup makes the re-done part a no-op.
 *
 * Additive, reversible, no data rewrite. Existing rows default to 0, which means
 * "start from the beginning" — correct for anything already recorded.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('whatsapp_history_imports', 'cursor')
  if (!has) {
    await knex.raw(`
      ALTER TABLE whatsapp_history_imports
        ADD COLUMN cursor integer NOT NULL DEFAULT 0
    `)
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('whatsapp_history_imports', 'cursor')
  if (has) {
    await knex.raw(`ALTER TABLE whatsapp_history_imports DROP COLUMN cursor`)
  }
}
