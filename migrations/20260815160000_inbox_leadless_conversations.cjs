/**
 * WhatsApp Contact vs Lead V1 — leadless conversations.
 *
 * inbox_conversations is already one row per (business number, customer number).
 * That row is the memory of the decision for that phone:
 *   - leadId NULL  = a conversation SocialCRM is holding (not a Lead)
 *   - leadId set   = linked to a Lead
 *   - isPersonal   = user said this number is personal; never auto-promote
 *
 * Additive / reversible. No backfill — existing rows keep their leadId and
 * stay Leads. Facebook / Instagram Lead Ads are untouched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // Unquoted identifiers fold to lowercase in PostgreSQL, so the original
  // mixed-case name must be quoted or DROP is a no-op and the CASCADE FK stays.
  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP CONSTRAINT IF EXISTS "inbox_conversations_leadId_fkey"
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP CONSTRAINT IF EXISTS inbox_conversations_leadid_fkey
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      ALTER COLUMN "leadId" DROP NOT NULL
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD CONSTRAINT inbox_conversations_leadid_fkey
      FOREIGN KEY ("leadId") REFERENCES clients(id) ON DELETE SET NULL
  `)

  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD COLUMN IF NOT EXISTS "isPersonal" boolean NOT NULL DEFAULT false
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD COLUMN IF NOT EXISTS "personalMarkedByUserId" integer NULL
      REFERENCES users(id) ON DELETE SET NULL
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD COLUMN IF NOT EXISTS "personalMarkedAt" timestamptz NULL
  `)

  await knex.raw(`
    ALTER TABLE inbox_messages
      ALTER COLUMN "leadId" DROP NOT NULL
  `)
  await knex.raw(`
    ALTER TABLE inbox_messages
      DROP CONSTRAINT IF EXISTS inbox_messages_leadId_fkey
  `)
  await knex.raw(`
    ALTER TABLE inbox_messages
      ADD CONSTRAINT inbox_messages_leadId_fkey
      FOREIGN KEY ("leadId") REFERENCES clients(id) ON DELETE SET NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE inbox_messages
      DROP CONSTRAINT IF EXISTS inbox_messages_leadId_fkey
  `)

  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP COLUMN IF EXISTS "personalMarkedAt"
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP COLUMN IF EXISTS "personalMarkedByUserId"
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP COLUMN IF EXISTS "isPersonal"
  `)

  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP CONSTRAINT IF EXISTS "inbox_conversations_leadId_fkey"
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      DROP CONSTRAINT IF EXISTS inbox_conversations_leadid_fkey
  `)
  await knex.raw(`
    ALTER TABLE inbox_conversations
      ADD CONSTRAINT inbox_conversations_leadId_fkey
      FOREIGN KEY ("leadId") REFERENCES clients(id) ON DELETE CASCADE
  `)
}
