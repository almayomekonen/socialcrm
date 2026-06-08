/**
 * Inbox messaging — Milestone 1: inbound WhatsApp persistence backbone.
 *
 * Three tables, mirroring the ai_conversations doctrine:
 *   - inbox_conversations  one thread per (channel, business number, customer)
 *   - inbox_participants   the endpoints of a thread (customer / business)
 *   - inbox_messages       append-only message timeline
 *
 * Doctrine:
 *   - Additive only. No existing table/column is renamed, retyped, or dropped.
 *   - Channel-agnostic columns (channel text) so future Messenger/IG-DM reuse
 *     the same tables; only 'whatsapp' is allowed for now.
 *   - Threads attach to the single Lead entity (clients), never a "Client".
 *   - JSONB for forward-compat (metadata) and raw capture (payload/rawPayload).
 *   - Dedup on (channel, "externalId") = the WhatsApp wamid.
 *   - Reversible: down() drops in reverse FK order.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // ─────────────────────── inbox_conversations ───────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS inbox_conversations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      channel text NOT NULL DEFAULT 'whatsapp'
        CHECK (channel IN ('whatsapp')),
      "businessPhoneNumberId" text NOT NULL,
      "customerWaId" text NOT NULL,
      "customerName" text,
      state text NOT NULL DEFAULT 'open'
        CHECK (state IN ('open','archived','closed')),
      "lastMessageAt" timestamptz,
      "lastInboundAt" timestamptz,
      "lastDirection" text,
      "unreadCount" integer NOT NULL DEFAULT 0,
      "messageCount" integer NOT NULL DEFAULT 0,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // One thread per customer per business number — enables idempotent upsert.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_conversations_thread_uniq
      ON inbox_conversations (channel, "businessPhoneNumberId", "customerWaId")
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS inbox_conversations_lead_lastmsg_idx
      ON inbox_conversations ("agencyId", "leadId", "lastMessageAt" DESC)
  `)

  // ──────────────────────── inbox_participants ───────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS inbox_participants (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      role text NOT NULL
        CHECK (role IN ('customer','business')),
      "waId" text NOT NULL,
      "displayName" text,
      "leadId" integer REFERENCES clients(id) ON DELETE SET NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // One customer + one business per 1:1 thread.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_participants_conv_role_uniq
      ON inbox_participants ("conversationId", role)
  `)

  // ────────────────────────── inbox_messages ─────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      direction text NOT NULL
        CHECK (direction IN ('inbound','outbound')),
      "externalId" text,
      "fromId" text,
      "toId" text,
      type text NOT NULL DEFAULT 'text'
        CHECK (type IN ('text','image','document','audio','video','sticker',
                        'location','contacts','interactive','button','reaction',
                        'system','unknown')),
      text text NOT NULL DEFAULT '',
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      "rawPayload" jsonb,
      status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received','sent','delivered','read','failed')),
      "errorReason" text,
      "sentByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "channelTimestamp" timestamptz,
      sequence bigint NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Dedup key — the WhatsApp wamid. NULLs are distinct (allowed for non-channel
  // messages), so this enforces idempotency only on real external ids.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_channel_external_uniq
      ON inbox_messages (channel, "externalId")
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_conv_seq_uniq
      ON inbox_messages ("conversationId", sequence)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS inbox_messages_conv_created_idx
      ON inbox_messages ("conversationId", "createdAt" DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS inbox_messages`)
  await knex.raw(`DROP TABLE IF EXISTS inbox_participants`)
  await knex.raw(`DROP TABLE IF EXISTS inbox_conversations`)
}
