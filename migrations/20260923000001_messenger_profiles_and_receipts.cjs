/**
 * Messenger — customer profiles, delivery receipts, and non-message events.
 *
 * ADDITIVE ONLY. Three concerns, one migration because they are one deploy:
 *
 * 1. PROFILE (messenger_conversations). The webhook carries a PSID and nothing
 *    else — no name, no picture. Both come from the User Profile API, which per
 *    https://developers.facebook.com/docs/messenger-platform/identity/user-profile
 *    (checked 2026-09-23) gates `first_name`, `last_name` AND `profile_pic`
 *    behind the *Business Asset User Profile Access* feature — NOT behind
 *    `pages_messaging`. An app without that feature gets a refusal for every
 *    contact, forever.
 *
 *    So the outcome is recorded, not just the value. `profileStatus` separates
 *    "Meta refused us this capability" (denied — stop asking, tell the admin
 *    why) from "we have not asked yet" (null) and "asked, nothing came back"
 *    (unavailable — the person may simply have no picture). Without it the
 *    only way to tell a missing name from an unapproved app is to re-call Graph
 *    for every contact on every render.
 *
 *    `profilePicUrl` is a signed Meta CDN URL that EXPIRES. It is therefore
 *    stored with `profileFetchedAt` and treated as a cache, never as a fact:
 *    stale rows are refreshed in the background and the UI falls back to
 *    initials the moment an <img> fails. No invented name is ever written —
 *    a refusal leaves `customerName` NULL.
 *
 * 2. RECEIPTS (messenger_messages). `message_deliveries` and `message_reads`
 *    report a WATERMARK — a timestamp meaning "everything up to here" — not a
 *    message id. They are stored per message so the UI can show a state it can
 *    prove, and stay silent otherwise. Nullable on purpose: NULL means "no
 *    event seen", which is not the same as "not delivered".
 *
 * 3. EVENTS (messenger_events). Postbacks, referrals and reactions are not
 *    messages and must not be stored as one — a postback in messenger_messages
 *    would corrupt the (pageId, mid) dedupe key, the conversation preview and
 *    the 24-hour window. They get their own table, keyed for idempotency the
 *    same way, because Meta redelivers these too.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // ── 1. Profile ────────────────────────────────────────────────────────────
  await knex.raw(`
    ALTER TABLE messenger_conversations
      ADD COLUMN IF NOT EXISTS "profilePicUrl" text,
      ADD COLUMN IF NOT EXISTS "profileFetchedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "profileStatus" text
  `)
  // Added separately: ADD CONSTRAINT has no IF NOT EXISTS, so a re-run would abort.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'messenger_conversations_profile_status_chk'
      ) THEN
        ALTER TABLE messenger_conversations
          ADD CONSTRAINT messenger_conversations_profile_status_chk
          CHECK ("profileStatus" IS NULL OR "profileStatus" IN ('ok','denied','unavailable'));
      END IF;
    END $$;
  `)
  // The background refresh asks one question: which rows of this agency are due?
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_conversations_profile_refresh_idx
      ON messenger_conversations ("agencyId", "profileFetchedAt")
      WHERE "profileStatus" IS DISTINCT FROM 'denied'
  `)

  // ── 2. Delivery / read receipts ───────────────────────────────────────────
  await knex.raw(`
    ALTER TABLE messenger_messages
      ADD COLUMN IF NOT EXISTS "deliveredAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "readAt" timestamptz
  `)
  // A watermark applies to every outbound message of a conversation at or below
  // a timestamp; this is the exact shape of that UPDATE's WHERE clause.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_messages_outbound_watermark_idx
      ON messenger_messages ("conversationId", (COALESCE("channelTimestamp", "createdAt")))
      WHERE direction = 'outbound'
  `)

  // ── 3. Non-message events ─────────────────────────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS messenger_events (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "pageId" varchar(64) NOT NULL,
      kind text NOT NULL CHECK (kind IN ('postback','referral','reaction','optin')),
      -- Idempotency key. Meta gives no id for these, so it is derived from the
      -- event's own content (see lib/facebook/messenger/parseMessagingEvent.ts).
      "eventKey" text NOT NULL,
      -- Postback/quick-reply payload, referral ref/source, or reaction emoji.
      title text,
      payload text,
      -- The message a reaction refers to. No FK: the reaction can outrun the echo.
      "targetMid" text,
      "occurredAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS messenger_events_page_key_uniq
      ON messenger_events ("pageId", "eventKey")
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_events_conv_idx
      ON messenger_events ("conversationId", "occurredAt")
  `)

  // ── 4. The durable receipt now carries more than messages ──────────────────
  // messenger_webhook_events.kind was CHECK (kind IN ('inbound','echo')). The
  // webhook records a receipt BEFORE processing, so a delivery/read/postback
  // receipt would be rejected by the old constraint and the whole delivery would
  // be answered 503 — a retry loop on the subscription Lead Ads shares. Widened,
  // never narrowed: every value that was legal stays legal.
  await knex.raw(`
    ALTER TABLE messenger_webhook_events
      DROP CONSTRAINT IF EXISTS messenger_webhook_events_kind_check
  `)
  await knex.raw(`
    ALTER TABLE messenger_webhook_events
      ADD CONSTRAINT messenger_webhook_events_kind_check
      CHECK (kind IN ('inbound','echo','delivery','read','postback','referral','reaction'))
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  // Rows added under the widened constraint would violate the original one, so
  // they are removed before it is restored. They are webhook receipts already
  // processed; nothing reads them after the fact.
  await knex.raw(`
    DELETE FROM messenger_webhook_events WHERE kind NOT IN ('inbound','echo')
  `)
  await knex.raw(`
    ALTER TABLE messenger_webhook_events
      DROP CONSTRAINT IF EXISTS messenger_webhook_events_kind_check
  `)
  await knex.raw(`
    ALTER TABLE messenger_webhook_events
      ADD CONSTRAINT messenger_webhook_events_kind_check CHECK (kind IN ('inbound','echo'))
  `)
  await knex.raw(`DROP TABLE IF EXISTS messenger_events`)
  await knex.raw(`DROP INDEX IF EXISTS messenger_messages_outbound_watermark_idx`)
  await knex.raw(`ALTER TABLE messenger_messages DROP COLUMN IF EXISTS "deliveredAt", DROP COLUMN IF EXISTS "readAt"`)
  await knex.raw(`DROP INDEX IF EXISTS messenger_conversations_profile_refresh_idx`)
  await knex.raw(`
    ALTER TABLE messenger_conversations
      DROP CONSTRAINT IF EXISTS messenger_conversations_profile_status_chk
  `)
  await knex.raw(`
    ALTER TABLE messenger_conversations
      DROP COLUMN IF EXISTS "profilePicUrl",
      DROP COLUMN IF EXISTS "profileFetchedAt",
      DROP COLUMN IF EXISTS "profileStatus"
  `)
}
