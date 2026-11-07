/**
 * WhatsApp opt-out: one current state per (business, customer number), plus an
 * append-only history of every command and every manual exception.
 *
 * whatsapp_opt_outs
 *   One row per ("agencyId", "customerPhoneE164"), created the first time the
 *   customer opts out of that business. Re-opting in flips the status; it never
 *   deletes the row and never clears "firstOptedOutAt".
 *   "lastEventAt" is the customer message timestamp that set the current
 *   status. A command older than it is recorded as stale and changes nothing,
 *   so a redelivered or reordered message cannot undo a newer decision.
 *
 * whatsapp_opt_out_events
 *   Append-only history: opt-out and re-opt-in commands with their outcome,
 *   and manual template exceptions with the category and the rep's reason.
 *   It holds no message text. A redelivered inbound command collides on
 *   ("agencyId", "messageExternalId") and is not recorded twice.
 *
 * TENANCY. Every row carries "agencyId". An opt-out for one business never
 * affects another business, even for the same customer number.
 *
 * NUMBERS. "customerPhoneE164" is E.164 with a leading '+', the same number
 * the send path hands to Meta (lib/whatsapp/optOut/phone.ts).
 *
 * Additive and reversible.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS whatsapp_opt_outs (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "customerPhoneE164" varchar(16) NOT NULL CHECK ("customerPhoneE164" ~ '^\\+[1-9][0-9]{7,14}$'),
      status text NOT NULL CHECK (status IN ('opted_out','opted_in')),
      "firstOptedOutAt" timestamptz NOT NULL,
      "optedOutAt" timestamptz NOT NULL,
      "optedInAt" timestamptz,
      "lastEventAt" timestamptz NOT NULL,
      "lastEventId" bigint,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_opt_outs_customer_uniq
      ON whatsapp_opt_outs ("agencyId", "customerPhoneE164")
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS whatsapp_opt_out_events (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "customerPhoneE164" varchar(16) NOT NULL CHECK ("customerPhoneE164" ~ '^\\+[1-9][0-9]{7,14}$'),
      kind text NOT NULL CHECK (kind IN ('opt_out','opt_in','manual_exception')),
      source text NOT NULL CHECK (source IN ('inbound_command','manual_template')),
      outcome text NOT NULL
        CHECK (outcome IN ('applied','stale','already_in_state','no_active_opt_out','granted')),
      -- The customer message's own timestamp for a command; the decision time for an exception.
      "eventAt" timestamptz NOT NULL,
      -- The inbound wamid for a command. No message text is stored.
      "messageExternalId" text,
      "actorUserId" integer,
      "templateId" integer,
      "templateName" text,
      "templateCategory" text,
      reason text,
      "providerMessageId" text,
      "recordedAt" timestamptz NOT NULL DEFAULT now(),
      CHECK (kind <> 'manual_exception' OR ("actorUserId" IS NOT NULL AND "templateCategory" IS NOT NULL AND reason IS NOT NULL)),
      CHECK (kind = 'manual_exception' OR "messageExternalId" IS NOT NULL)
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_opt_out_events_message_uniq
      ON whatsapp_opt_out_events ("agencyId", "messageExternalId")
      WHERE "messageExternalId" IS NOT NULL
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_opt_out_events_customer_idx
      ON whatsapp_opt_out_events ("agencyId", "customerPhoneE164", id)
  `)
}

exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS whatsapp_opt_out_events`)
  await knex.raw(`DROP TABLE IF EXISTS whatsapp_opt_outs`)
}
