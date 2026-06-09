/**
 * Inbox list performance: agency-wide ordering by recent activity.
 *
 * The Inbox lists conversations across the whole agency ordered by lastMessageAt
 * (keyset paginated). The existing index is (agencyId, leadId, lastMessageAt) —
 * good for a single lead, not for agency-wide ordering. This adds the index that
 * backs the list query + keyset seek. Additive only; reversible.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS inbox_conversations_agency_lastmsg_idx
      ON inbox_conversations ("agencyId", "lastMessageAt" DESC, id DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS inbox_conversations_agency_lastmsg_idx`)
}
