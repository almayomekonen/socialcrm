/**
 * WhatsApp business-scoped user ID (BSUID) on a conversation.
 *
 * WHY. Meta now sends every WhatsApp user's business-scoped user ID in
 * webhooks (`from_user_id` on inbound messages, `to_user_id` on Coexistence
 * echoes), and supporting it is required of every partner. Once a user adopts
 * a WhatsApp username, the phone number (`from` / `to`) can be omitted, and the
 * BSUID becomes the only way to recognise them. This column records it next to
 * the phone number while the phone is still present, so later work can resolve
 * those customers. Nothing reads it yet.
 *
 * FORMAT (Meta): an ISO 3166 alpha-2 country code, a period, then up to 128
 * alphanumeric characters, e.g. `US.13491208655302741918`. Parent BSUIDs
 * (`US.ENT.…`) are a different identifier and deliberately do not fit.
 *
 * SCOPE. A BSUID is unique per business portfolio and user, so the unique index
 * is scoped exactly like the existing thread key (`channel`,
 * `businessPhoneNumberId`): one conversation per user per business number. It
 * never relates conversations across business numbers, agencies or portfolios.
 *
 * PURELY ADDITIVE. A nullable column with no default (no table rewrite), a
 * CHECK that every existing row (NULL) satisfies, and a partial index over
 * non-NULL values only. No existing row, column, index or constraint changes.
 *
 * CONCURRENTLY, because `inbox_conversations` takes live webhook writes; it
 * cannot run inside a transaction, hence `exports.config`.
 *
 * @param {import('knex').Knex} knex
 */

exports.config = { transaction: false }

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD COLUMN IF NOT EXISTS "customerUserId" text NULL
        CONSTRAINT inbox_conversations_customer_user_id_format
        CHECK ("customerUserId" IS NULL OR "customerUserId" ~ '^[A-Z]{2}\\.[A-Za-z0-9]{1,128}$')
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS inbox_conversations_customer_user_id_uniq
      ON inbox_conversations (channel, "businessPhoneNumberId", "customerUserId")
      WHERE "customerUserId" IS NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS inbox_conversations_customer_user_id_uniq`)
  await knex.raw(`ALTER TABLE inbox_conversations DROP COLUMN IF EXISTS "customerUserId"`)
}
