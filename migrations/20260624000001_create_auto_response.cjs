/**
 * Instant Response Engine — Phase 1. Additive, reversible.
 * auto_response_jobs: transactional outbox + immutable audit ledger.
 * auto_response_settings: per (agency, channel) opt-in config.
 * agencies.autoResponseEnabled: workspace master switch (default OFF).
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS auto_response_jobs (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      channel text NOT NULL,
      reason text NOT NULL CHECK (reason IN ('first_contact')),
      "triggerSequence" integer NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','sent','skipped','failed','dead')),
      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 3,
      "notBefore" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz, "lockedBy" text,
      "sentMessageId" bigint, "skipReason" text, "lastError" text,
      phase smallint NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)
  // At most one in-flight job per conversation (dedup, race-proof):
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS auto_response_jobs_inflight_uniq
      ON auto_response_jobs ("conversationId") WHERE status IN ('pending','processing')`)
  // "already acted" ledger lookups + worker claim:
  await knex.raw(`CREATE INDEX IF NOT EXISTS auto_response_jobs_conv_reason_status_idx
      ON auto_response_jobs ("conversationId", reason, status)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS auto_response_jobs_claim_idx
      ON auto_response_jobs (status, "notBefore")`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS auto_response_settings (
      "agencyId" integer NOT NULL,
      channel text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      "quietHours" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "dailyCap" integer NOT NULL DEFAULT 200,
      guidance text,
      "updatedBy" integer, "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("agencyId", channel)
    )`)

  const has = await knex.schema.hasColumn('agencies', 'autoResponseEnabled')
  if (!has) await knex.schema.alterTable('agencies', (t) => {
    t.boolean('autoResponseEnabled').notNullable().defaultTo(false)
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('agencies', (t) => t.dropColumn('autoResponseEnabled'))
  await knex.raw(`DROP TABLE IF EXISTS auto_response_settings`)
  await knex.raw(`DROP TABLE IF EXISTS auto_response_jobs`)
}
