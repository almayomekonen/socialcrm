exports.config = { transaction: false }

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)

  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD COLUMN IF NOT EXISTS "lastMessageText" text
  `)

  await knex.raw(`
    UPDATE inbox_conversations cv
       SET "lastMessageText" = m.text
      FROM (
        SELECT DISTINCT ON ("conversationId") "conversationId", text
          FROM inbox_messages
         ORDER BY "conversationId", sequence DESC
      ) m
     WHERE m."conversationId" = cv.id
       AND cv."lastMessageText" IS DISTINCT FROM m.text
  `)

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_conversations_lastmsgtext_trgm_idx
      ON inbox_conversations USING gin ("lastMessageText" gin_trgm_ops)
  `)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_conversations_customerwaid_trgm_idx
      ON inbox_conversations USING gin ("customerWaId" gin_trgm_ops)
  `)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_name_trgm_idx
      ON clients USING gin (name gin_trgm_ops)
  `)

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_conversations_agency_state_lastmsg_idx
      ON inbox_conversations ("agencyId", state, "lastMessageAt" DESC, id DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS inbox_conversations_agency_state_lastmsg_idx`)
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS clients_name_trgm_idx`)
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS inbox_conversations_customerwaid_trgm_idx`)
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS inbox_conversations_lastmsgtext_trgm_idx`)
  await knex.raw(`ALTER TABLE inbox_conversations DROP COLUMN IF EXISTS "lastMessageText"`)
}
