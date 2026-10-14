/**
 * Owner WhatsApp reminders, PR B: one reminder per hand-off, its deliveries,
 * and the delivery statuses Meta reports for them.
 *
 * owner_whatsapp_reminders
 *   One row per (conversation, escalation). The unique key is the dedup: an
 *   escalation is reminded about at most once, however often the tick runs.
 *   status: scheduled -> done | cancelled.
 *
 * owner_whatsapp_reminder_deliveries
 *   One row per (reminder, recipient). status:
 *     scheduled -> sending -> sent | failed | unknown
 *     scheduled -> cancelled (re-check failed before sending)
 *   `sending` is committed BEFORE the Graph call, so a crash mid-send leaves a
 *   row that is later marked `unknown` and never sent again. `unknown` is never
 *   retried. `errorScope = 'account'` pauses all sends for a while.
 *
 * owner_whatsapp_message_status
 *   Meta's delivery statuses for platform-number messages, keyed by message id
 *   and filled by the platform webhook whether it arrives before or after the
 *   send result is saved. Statuses only move forward.
 *
 * ADDITIVE ONLY: three new tables. The only foreign key is between two of the
 * new tables; nothing references or alters an existing table.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_whatsapp_reminders (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "conversationId" bigint NOT NULL,
      "escalatedAt" timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('scheduled','done','cancelled')),
      "cancelReason" text NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_reminders_escalation_uniq
      ON owner_whatsapp_reminders ("conversationId", "escalatedAt")
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS owner_whatsapp_reminders_open_idx
      ON owner_whatsapp_reminders ("conversationId") WHERE status = 'scheduled'
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_whatsapp_reminder_deliveries (
      id bigserial PRIMARY KEY,
      "reminderId" bigint NOT NULL REFERENCES owner_whatsapp_reminders(id) ON DELETE CASCADE,
      "recipientId" bigint NOT NULL,
      "agencyId" integer NOT NULL,
      "conversationId" bigint NOT NULL,
      status text NOT NULL CHECK (status IN ('scheduled','sending','sent','failed','unknown','cancelled')),
      attempts integer NOT NULL DEFAULT 0,
      "nextAttemptAt" timestamptz NOT NULL,
      "lockedAt" timestamptz NULL,
      wamid text NULL,
      "errorCode" text NULL,
      "errorScope" text NULL CHECK ("errorScope" IS NULL OR "errorScope" IN ('recipient','account','rate_limit','other')),
      "cancelReason" text NULL,
      "sentAt" timestamptz NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_reminder_deliveries_recipient_uniq
      ON owner_whatsapp_reminder_deliveries ("reminderId", "recipientId")
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_reminder_deliveries_wamid_uniq
      ON owner_whatsapp_reminder_deliveries (wamid) WHERE wamid IS NOT NULL
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS owner_whatsapp_reminder_deliveries_due_idx
      ON owner_whatsapp_reminder_deliveries ("nextAttemptAt") WHERE status IN ('scheduled','sending')
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS owner_whatsapp_reminder_deliveries_cooldown_idx
      ON owner_whatsapp_reminder_deliveries ("conversationId", "updatedAt")
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_whatsapp_message_status (
      wamid text PRIMARY KEY,
      status text NOT NULL CHECK (status IN ('sent','delivered','read','failed')),
      "sentAt" timestamptz NULL,
      "deliveredAt" timestamptz NULL,
      "readAt" timestamptz NULL,
      "failedAt" timestamptz NULL,
      "errorCode" text NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS owner_whatsapp_message_status`)
  await knex.raw(`DROP TABLE IF EXISTS owner_whatsapp_reminder_deliveries`)
  await knex.raw(`DROP TABLE IF EXISTS owner_whatsapp_reminders`)
}
