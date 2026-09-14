/**
 * Facebook Messenger (Page DMs) — storage.
 *
 * WHY NOT inbox_conversations. That table's `channel` CHECK allows only
 * 'whatsapp', its thread key is ("businessPhoneNumberId", "customerWaId"), and
 * roughly twenty readers across the Today brief, AI facts, notifications and
 * the native mobile API read it WITHOUT a channel filter — the mobile client
 * rejects any non-WhatsApp row outright. Widening the live constraint would
 * put WhatsApp at risk to add a channel. Same decision, same reasoning, as
 * facebook_page_comments.
 *
 * IDENTITY. A Messenger contact is a Page-scoped ID (PSID): the same person
 * has a different PSID on every Page, and a PSID means nothing without its
 * Page. A conversation is keyed by ("agencyId", "pageId", psid) — never by PSID
 * alone, never by a global Facebook user id. The agency is part of the key so a
 * Page that is disconnected and later connected by another agency starts fresh
 * conversations there, instead of every message being refused because an old
 * row belongs to the previous owner.
 *
 * TENANCY. "agencyId" is denormalised from facebook_pages, written ONLY from
 * the Page resolved via the signature-verified webhook entry id. Every read
 * filters on it.
 *
 * DEDUP. Meta redelivers on any failure and also echoes every message the Page
 * sends. A message is keyed by ("pageId", mid): the Send API response and the
 * `message_echoes` webhook for the same message converge on one row.
 *
 * ADDITIVE ONLY. New tables; nothing existing is touched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS messenger_conversations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "pageId" varchar(64) NOT NULL,
      psid text NOT NULL,
      "customerName" text,
      "leadId" integer REFERENCES clients(id) ON DELETE SET NULL,
      "lastMessageAt" timestamptz,
      -- The standard messaging window is measured from the customer's last message.
      "lastInboundAt" timestamptz,
      "lastMessageText" text,
      "lastDirection" text CHECK ("lastDirection" IN ('inbound','outbound')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS messenger_conversations_agency_page_psid_uniq
      ON messenger_conversations ("agencyId", "pageId", psid)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_conversations_agency_lastmsg_idx
      ON messenger_conversations ("agencyId", "lastMessageAt" DESC, id DESC)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_conversations_lead_idx
      ON messenger_conversations ("leadId")
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS messenger_messages (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "pageId" varchar(64) NOT NULL,
      mid text NOT NULL,
      direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
      -- Who produced it: the customer, SocialCRM (our app id), a person in Meta
      -- Business Suite's Page inbox, or another app connected to the Page.
      source text NOT NULL CHECK (source IN ('customer','socialcrm','page_inbox','other_app')),
      text text NOT NULL DEFAULT '',
      -- [{ type, url }] as delivered. URLs are Meta CDN links, never tokens.
      attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      "sentByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "channelTimestamp" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS messenger_messages_page_mid_uniq
      ON messenger_messages ("pageId", mid)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_messages_conv_timeline_idx
      ON messenger_messages ("conversationId", (COALESCE("channelTimestamp", "createdAt")), id)
  `)

  // FK lookups when a user is deleted (ON DELETE SET NULL scans otherwise).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_messages_sent_by_idx
      ON messenger_messages ("sentByUserId") WHERE "sentByUserId" IS NOT NULL
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS messenger_conversation_reads (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
      "userId" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "lastReadAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS messenger_conversation_reads_conv_user_uniq
      ON messenger_conversation_reads ("conversationId", "userId")
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_conversation_reads_user_idx
      ON messenger_conversation_reads ("userId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS messenger_conversation_reads`)
  await knex.raw(`DROP TABLE IF EXISTS messenger_messages`)
  await knex.raw(`DROP TABLE IF EXISTS messenger_conversations`)
}
