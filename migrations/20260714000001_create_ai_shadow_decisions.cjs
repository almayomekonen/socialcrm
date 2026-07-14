/**
 * AI Runtime — Integration-2: shadow-decision sink.
 *
 * An isolated, additive table that records the runtime's shadow cognition output
 * (the M6 GateDecision) for offline comparison against the legacy conversation
 * intelligence. Nothing in production reads it.
 *
 * Doctrine (mirrors the M1 substrate migration):
 *   - Additive only. No existing table/column is renamed, retyped, or dropped.
 *   - Isolated: no foreign key to any production table (conversationId is a soft
 *     reference), so the shadow store can never block or cascade a production
 *     write/delete, and can be truncated/dropped independently.
 *   - Scope-first: every row carries "agencyId".
 *   - Idempotent per turn: a unique index on (agencyId, conversationId, turnCount)
 *     lets a re-processed turn upsert rather than duplicate.
 *   - Reversible: down() drops the table.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_shadow_decisions (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      "conversationId" bigint,
      "turnCount" integer,
      outcome text NOT NULL CHECK (outcome IN ('recommend','stay_silent','rejected')),
      emitted boolean NOT NULL,
      "rejectionBoundary" text,
      decision jsonb NOT NULL,
      "runtimeAsOf" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  // Idempotency: one shadow decision per (agency, conversation, turn) — upsert target.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_shadow_decisions_turn_uniq
      ON ai_shadow_decisions ("agencyId", "conversationId", "turnCount")
  `)
  // Query a subject's shadow decisions (comparison/inspection).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_shadow_decisions_subject_idx
      ON ai_shadow_decisions ("agencyId", "subjectType", "subjectId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_shadow_decisions`)
}
