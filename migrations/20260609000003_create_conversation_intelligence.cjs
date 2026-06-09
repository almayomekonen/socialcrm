/**
 * Conversation Intelligence — Phase 0: async pipeline backbone (no LLM).
 *
 * Three tables, all keyed by conversationId (never leadId) and channel-agnostic so
 * future Instagram/Messenger/Email reuse them unchanged:
 *   - conversation_intelligence       current analysis snapshot per (conversation, kind)
 *   - conversation_analysis_jobs       durable outbox/queue (SKIP LOCKED drain)
 *   - conversation_intelligence_runs   append-only audit of every run (version/cost)
 *
 * Doctrine:
 *   - Additive only. No existing table/column renamed, retyped, or dropped.
 *   - Analysis is a persisted artifact read at render time — never computed in a
 *     webhook or during Inbox rendering.
 *   - Versioned: analyzerVersion / schemaVersion / promptVersion + coveredSequence
 *     + inputHash drive re-analysis and staleness without recomputing blindly.
 *   - Reversible: down() drops in reverse FK order.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // ───────────────────── conversation_intelligence ─────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS conversation_intelligence (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      kind text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'fresh'
        CHECK (status IN ('fresh','stale','failed')),
      "schemaVersion" integer NOT NULL DEFAULT 1,
      "promptVersion" text,
      "analyzerVersion" text NOT NULL,
      "modelProvider" text,
      "modelId" text,
      "coveredSequence" bigint NOT NULL DEFAULT 0,
      "inputHash" text,
      confidence text,
      "inputTokens" integer NOT NULL DEFAULT 0,
      "outputTokens" integer NOT NULL DEFAULT 0,
      "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
      "lastError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // One current row per (conversation, kind) — idempotent upsert + O(1) read.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_intelligence_conv_kind_uniq
      ON conversation_intelligence ("conversationId", kind)
  `)
  // Tenant-scoped reads (Inbox panel).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS conversation_intelligence_agency_conv_idx
      ON conversation_intelligence ("agencyId", "conversationId")
  `)

  // ───────────────────── conversation_analysis_jobs ────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS conversation_analysis_jobs (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      reason text NOT NULL DEFAULT 'new_message'
        CHECK (reason IN ('new_message','manual','version_bump','backfill')),
      "triggerSequence" bigint NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','done','failed','dead')),
      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 5,
      "notBefore" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      "lastError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Coalescing: at most one PENDING job per conversation. A burst of messages
  // updates the same pending row (triggerSequence/notBefore) instead of piling up.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_analysis_jobs_pending_uniq
      ON conversation_analysis_jobs ("conversationId")
      WHERE status = 'pending'
  `)
  // Drain seek: due pending jobs, oldest first.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS conversation_analysis_jobs_due_idx
      ON conversation_analysis_jobs (status, "notBefore")
  `)
  // Stale-lease reclaim: processing jobs whose lease expired.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS conversation_analysis_jobs_locked_idx
      ON conversation_analysis_jobs (status, "lockedAt")
  `)

  // ─────────────────── conversation_intelligence_runs ──────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS conversation_intelligence_runs (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "jobId" bigint,
      kind text NOT NULL,
      success boolean NOT NULL,
      "analyzerVersion" text NOT NULL,
      "schemaVersion" integer NOT NULL DEFAULT 1,
      "modelProvider" text,
      "modelId" text,
      "coveredSequence" bigint NOT NULL DEFAULT 0,
      "inputHash" text,
      "inputTokens" integer NOT NULL DEFAULT 0,
      "outputTokens" integer NOT NULL DEFAULT 0,
      "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
      "latencyMs" integer,
      "errorReason" text,
      data jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS conversation_intelligence_runs_conv_created_idx
      ON conversation_intelligence_runs ("conversationId", "createdAt" DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS conversation_intelligence_runs`)
  await knex.raw(`DROP TABLE IF EXISTS conversation_analysis_jobs`)
  await knex.raw(`DROP TABLE IF EXISTS conversation_intelligence`)
}
