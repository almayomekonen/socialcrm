/**
 * SocialCRM AI over WhatsApp, pilot: one row per message a verified owner sends
 * the platform number while the assistant is enabled for their agency.
 *
 * The same row is the queue, the bounded conversation memory, the rate-limit and
 * spend ledger, and the reply state machine:
 *
 *   status:      queued -> running -> answered | refused | failed | expired
 *   replyState:  null -> sending -> sent | failed | unknown      (or skipped)
 *
 * `sending` is committed BEFORE the Graph call, so a crash mid-send leaves a row
 * that is never sent again (`unknown` is never retried). `wamid` is unique: a
 * redelivered message can never create a second job or a second reply.
 *
 * `question` and `answerHeadline` are the only text, are capped, and are cleared
 * by the worker 24 hours after the message (no customer phone number or email is
 * ever written here; the reply is redacted before it is stored or sent).
 *
 * ADDITIVE ONLY: one new table, no foreign key, nothing existing is altered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS wa_assistant_jobs (
      id bigserial PRIMARY KEY,
      wamid text NOT NULL,
      "recipientId" bigint NOT NULL,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      kind text NOT NULL CHECK (kind IN ('text','unsupported')),
      question text NULL CHECK (question IS NULL OR char_length(question) <= 1000),
      "messageTimestamp" bigint NOT NULL,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','answered','refused','failed','expired')),
      "refusalReason" text NULL,
      attempts integer NOT NULL DEFAULT 0,
      "lockedAt" timestamptz NULL,
      "replyState" text NULL CHECK ("replyState" IS NULL OR "replyState" IN ('sending','sent','failed','unknown','skipped')),
      "replyWamid" text NULL,
      "replyErrorCode" text NULL,
      "answerHeadline" text NULL CHECK ("answerHeadline" IS NULL OR char_length("answerHeadline") <= 600),
      "stopReason" text NULL,
      "costUsd" numeric(10,5) NOT NULL DEFAULT 0,
      "durationMs" integer NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS wa_assistant_jobs_wamid_uniq ON wa_assistant_jobs (wamid)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS wa_assistant_jobs_recipient_idx ON wa_assistant_jobs ("recipientId", "createdAt")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS wa_assistant_jobs_agency_idx ON wa_assistant_jobs ("agencyId", "createdAt")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS wa_assistant_jobs_open_idx ON wa_assistant_jobs ("createdAt") WHERE status IN ('queued','running')`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS wa_assistant_jobs`)
}
