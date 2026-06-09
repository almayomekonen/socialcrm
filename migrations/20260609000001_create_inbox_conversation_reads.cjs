/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS inbox_conversation_reads (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "userId" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "lastReadAt" timestamptz NOT NULL DEFAULT now(),
      "lastReadMessageId" bigint,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_conversation_reads_conv_user_uniq
      ON inbox_conversation_reads ("conversationId", "userId")
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS inbox_conversation_reads_agency_user_idx
      ON inbox_conversation_reads ("agencyId", "userId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS inbox_conversation_reads`)
}
