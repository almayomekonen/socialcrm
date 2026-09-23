/**
 * Messenger — record that a conversation's history was imported from Meta.
 *
 * WHY A COLUMN AND NOT A DERIVED CHECK. The Conversations API returns details
 * for only the TWENTY most recent messages of a conversation
 * (https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations,
 * checked 2026-09-23: "you can only get details about the 20 most recent
 * messages in the conversation"). So an import can never be "complete", and
 * message count tells you nothing about whether one ran.
 *
 * Without this, the UI has no way to distinguish three genuinely different
 * states that all look like a short thread:
 *   · never imported          → offer the import
 *   · imported, 20 recovered  → say that earlier messages are not available
 *                               from Facebook, so nobody hunts for a bug
 *   · imported, 3 recovered   → that is the whole conversation
 *
 * ADDITIVE ONLY.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE messenger_conversations
      ADD COLUMN IF NOT EXISTS "historyImportedAt" timestamptz
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE messenger_conversations
      DROP COLUMN IF EXISTS "historyImportedAt"
  `)
}
