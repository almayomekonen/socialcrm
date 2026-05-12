/**
 * Phase 1 of the AI conversation architecture: persistence backbone.
 *
 * Three append-only tables:
 *   - ai_conversations  thread container, one default per (agencyId, leadId)
 *   - ai_messages       append-only timeline (user / assistant / system)
 *   - ai_runs           AI execution metadata — the ONLY place provider/model live
 *
 * Doctrine:
 *   - Additive only. No existing column renamed, retyped, or dropped.
 *   - Messages never store provider or model. UI reads messages, never runs.
 *   - JSONB for forward-compat fields (metadata, structuredPayload, attachments).
 *   - Reversible: down() drops in reverse FK order.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // ───────────────────────── ai_conversations ─────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      "createdByUserId" integer NOT NULL REFERENCES users(id),
      title text,
      state text NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','archived')),
      "lastMessageAt" timestamptz,
      "messageCount" integer NOT NULL DEFAULT 0,
      "summaryText" text,
      "summaryUpdatedAt" timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // One active default thread per (agency, lead). Partial unique index → archived
  // threads can coexist with a new active one once Phase 2+ exposes archiving.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_conversations_active_default_uniq
      ON ai_conversations ("agencyId", "leadId")
      WHERE state = 'active'
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_conversations_lead_lastmsg_idx
      ON ai_conversations ("agencyId", "leadId", state, "lastMessageAt" DESC)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_conversations_user_lastmsg_idx
      ON ai_conversations ("agencyId", "createdByUserId", "lastMessageAt" DESC)
  `)

  // ──────────────────────────── ai_messages ───────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "parentMessageId" bigint REFERENCES ai_messages(id) ON DELETE SET NULL,
      role text NOT NULL
        CHECK (role IN ('user','assistant','system')),
      mode text,
      "taskKind" text,
      "actionId" text,
      status text NOT NULL DEFAULT 'complete'
        CHECK (status IN ('pending','streaming','complete','failed','aborted')),
      text text NOT NULL DEFAULT '',
      "structuredPayload" jsonb,
      attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      lenses jsonb NOT NULL DEFAULT '[]'::jsonb,
      "errorReason" text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "completedAt" timestamptz,
      sequence bigint NOT NULL
    )
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_messages_conv_seq_uniq
      ON ai_messages ("conversationId", sequence)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_messages_conv_created_idx
      ON ai_messages ("conversationId", "createdAt" DESC)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_messages_parent_idx
      ON ai_messages ("parentMessageId")
      WHERE "parentMessageId" IS NOT NULL
  `)

  // ────────────────────────────── ai_runs ─────────────────────────────
  // Execution truth. Provider and model live ONLY here. Runs survive message
  // deletion (ON DELETE SET NULL) so cost/audit history is preserved.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_runs (
      id bigserial PRIMARY KEY,
      "messageId" bigint REFERENCES ai_messages(id) ON DELETE SET NULL,
      "conversationId" bigint REFERENCES ai_conversations(id) ON DELETE SET NULL,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL,
      "userId" integer REFERENCES users(id) ON DELETE SET NULL,
      "taskKind" text NOT NULL,
      mode text,
      role text NOT NULL,
      provider text,
      model text,
      "chainIndex" smallint,
      "inputTokens" integer NOT NULL DEFAULT 0,
      "outputTokens" integer NOT NULL DEFAULT 0,
      "costUsd" numeric(10,6) NOT NULL DEFAULT 0,
      "latencyMs" integer,
      success boolean NOT NULL,
      "errorCode" text,
      "errorMessage" text,
      "streamingState" text,
      "startedAt" timestamptz NOT NULL,
      "endedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_runs_agency_created_idx
      ON ai_runs ("agencyId", "createdAt" DESC)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_runs_message_idx
      ON ai_runs ("messageId")
      WHERE "messageId" IS NOT NULL
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_runs_agency_task_created_idx
      ON ai_runs ("agencyId", "taskKind", "createdAt" DESC)
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_runs_agency_success_created_idx
      ON ai_runs ("agencyId", success, "createdAt" DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_runs`)
  await knex.raw(`DROP TABLE IF EXISTS ai_messages`)
  await knex.raw(`DROP TABLE IF EXISTS ai_conversations`)
}
