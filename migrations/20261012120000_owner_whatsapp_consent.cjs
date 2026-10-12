/**
 * Owner WhatsApp reminders, PR A: consent, verified number, opt-out.
 *
 * owner_whatsapp_recipients
 *   One row per (agency, user) who asked, in settings, to receive reminders on
 *   WhatsApp from the SocialCRM platform number. The row records the consent
 *   (when, which text version, where) and, once proven, the number: the user
 *   sends a one-time code from their phone, and the number is taken from
 *   Meta's signed `from` field, never typed.
 *
 *   status: pending (consented, code issued) -> active (code arrived from the
 *   phone) -> opted_out (keyword or settings). Only a new consent in settings
 *   returns an opted-out row to pending; no webhook outcome ever activates a
 *   row without a live code.
 *
 *   "activationMessageTimestamp" is Meta's send time (unix seconds) of the
 *   message that activated the row. A keyword opt-out applies to every row of
 *   that number activated at or before the opt-out's own send time (a tie goes
 *   to the opt-out), so the outcome does not depend on webhook arrival order.
 *
 *   The code itself is never stored: only an HMAC of it, cleared when used,
 *   expired or opted out.
 *
 * platform_whatsapp_inbound
 *   One row per inbound message to the platform number, by Meta message id
 *   (unique), so a redelivered message does nothing. Holds what was decided
 *   (`kind`), a keyed hash of the sender (rate limiting and opt-out ordering,
 *   never the raw number) and Meta's send time. NO message content.
 *
 * ADDITIVE ONLY: two new tables, no change to any existing table, column,
 * index or constraint. No foreign keys, deliberately: a constraint here would
 * change how existing users and agencies can be deleted.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_whatsapp_recipients (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      "phoneE164" text NULL CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\\+[1-9][0-9]{7,14}$'),
      status text NOT NULL CHECK (status IN ('pending','active','opted_out')),
      "consentAt" timestamptz NOT NULL,
      "consentTextVersion" text NOT NULL,
      "consentSource" text NOT NULL CHECK ("consentSource" IN ('settings')),
      "activationCodeHash" text NULL,
      "activationExpiresAt" timestamptz NULL,
      "activationMessageTimestamp" bigint NULL,
      "verifiedAt" timestamptz NULL,
      "optedOutAt" timestamptz NULL,
      "optOutSource" text NULL CHECK ("optOutSource" IS NULL OR "optOutSource" IN ('keyword','settings')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT owner_whatsapp_recipients_active_is_verified
        CHECK (status <> 'active' OR ("phoneE164" IS NOT NULL AND "verifiedAt" IS NOT NULL))
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_recipients_agency_user_uniq
      ON owner_whatsapp_recipients ("agencyId", "userId")
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS owner_whatsapp_recipients_phone_idx
      ON owner_whatsapp_recipients ("phoneE164") WHERE "phoneE164" IS NOT NULL
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_recipients_code_uniq
      ON owner_whatsapp_recipients ("activationCodeHash") WHERE "activationCodeHash" IS NOT NULL
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS platform_whatsapp_inbound (
      id bigserial PRIMARY KEY,
      wamid text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('opt_out','activation','activation_rejected','other')),
      "fromHash" text NULL,
      "messageTimestamp" bigint NOT NULL,
      "receivedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS platform_whatsapp_inbound_wamid_uniq
      ON platform_whatsapp_inbound (wamid)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS platform_whatsapp_inbound_sender_idx
      ON platform_whatsapp_inbound ("fromHash", kind, "receivedAt") WHERE "fromHash" IS NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS platform_whatsapp_inbound`)
  await knex.raw(`DROP TABLE IF EXISTS owner_whatsapp_recipients`)
}
