/**
 * The chronological ordering index for `inbox_messages`.
 *
 * WHY. Thread readers are moving from `ORDER BY sequence` to
 * `ORDER BY COALESCE("channelTimestamp", "createdAt"), id` — see
 * `lib/inbox/messageTimeline.ts` for the reasoning. `sequence` had a supporting
 * index (`inbox_messages_conv_seq_uniq`); the new expression has none, so every
 * thread open would become a sort over the conversation's messages. This index
 * makes the new ordering as cheap as the old one was.
 *
 * The leading `"conversationId"` matches the WHERE clause every thread reader
 * already has, so the index serves both the filter and the sort in one pass.
 * The trailing `id` is the deterministic tiebreak and must be part of the index
 * for the sort to be satisfied without a re-sort step.
 *
 * COALESCE over two plain timestamptz columns is immutable, so it is indexable.
 *
 * PURELY ADDITIVE. It creates one index and nothing else. `sequence` keeps its
 * type, its constraints and its unique index; the primary key and
 * `inbox_messages_channel_external_uniq` are untouched; no row is rewritten and
 * no data is read or changed.
 *
 * CONCURRENTLY, following `20260609000004_intelligence_value_indexes.cjs`.
 * `inbox_messages` takes live webhook writes, and a plain CREATE INDEX holds a
 * lock that blocks them for the duration of the build. `CONCURRENTLY` cannot run
 * inside a transaction, hence `exports.config`.
 *
 * @param {import('knex').Knex} knex
 */

exports.config = { transaction: false }

exports.up = async function (knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_messages_conv_timeline_idx
      ON inbox_messages ("conversationId", (COALESCE("channelTimestamp", "createdAt")), id)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS inbox_messages_conv_timeline_idx`)
}
