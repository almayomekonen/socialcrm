/**
 * AI Runtime — Wave 1 / M1: State Management substrate.
 *
 * Realizes the frozen ai-runtime-architecture.md (State Management, Part 3.2) and
 * the M0 interface freeze (claude/ai/wave-1/M0-interface-specification.md):
 * the resident belief store, its append-only version history, per-belief
 * provenance chains, and the protected narrative floor.
 *
 * Doctrine (mirrors conversation_intelligence):
 *   - Additive only. No existing table/column renamed, retyped, or dropped.
 *   - Scope-first: every row carries "agencyId"; nothing crosses operators.
 *   - Beliefs key to the existing Lead (clients.id, as text) or a logical
 *     portfolio subject — no new business entity is introduced.
 *   - Provenance is mandatory: a belief walks back to >=1 trace OR is
 *     explicitly absence-derived (enforced in the data layer + a CHECK here).
 *   - Versioned: every write appends an immutable snapshot to ai_belief_versions.
 *   - Narrative floor is protected: append-only, never pruned or consolidated.
 *   - Reversible: down() drops in reverse FK order.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // ───────────────────────────── ai_beliefs ─────────────────────────────
  // The resident belief store: one current row per (agency, subject, key).
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_beliefs (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      key text NOT NULL,
      content jsonb NOT NULL DEFAULT '{}'::jsonb,
      confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      groundedness numeric(5,4) NOT NULL CHECK (groundedness >= 0 AND groundedness <= 1),
      calibratable boolean NOT NULL DEFAULT true,
      "uncertaintyKind" text NOT NULL DEFAULT 'epistemic'
        CHECK ("uncertaintyKind" IN ('epistemic','aleatoric')),
      "evidenceFor" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "evidenceAgainst" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "isAbsenceDerived" boolean NOT NULL DEFAULT false,
      version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
      "freshnessAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // One current belief per (agency, subject, key) — race-safe upsert + O(1) read.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_beliefs_subject_key_uniq
      ON ai_beliefs ("agencyId", "subjectType", "subjectId", key)
  `)
  // Scoped read of a subject's whole belief set (World Model read surface).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_beliefs_subject_idx
      ON ai_beliefs ("agencyId", "subjectType", "subjectId")
  `)
  // Staleness sweep by age (consumed by the Scheduler in a later wave).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_beliefs_freshness_idx
      ON ai_beliefs ("agencyId", "freshnessAt")
  `)

  // ───────────────────────── ai_belief_versions ─────────────────────────
  // Append-only history: an immutable snapshot per write. State versioning.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_belief_versions (
      id bigserial PRIMARY KEY,
      "beliefId" bigint NOT NULL REFERENCES ai_beliefs(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      version integer NOT NULL CHECK (version >= 1),
      content jsonb NOT NULL,
      confidence numeric(5,4) NOT NULL,
      groundedness numeric(5,4) NOT NULL,
      calibratable boolean NOT NULL,
      "uncertaintyKind" text NOT NULL,
      "evidenceFor" jsonb NOT NULL,
      "evidenceAgainst" jsonb NOT NULL,
      "isAbsenceDerived" boolean NOT NULL,
      "traceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "inferentialDistance" text NOT NULL,
      "freshnessAt" timestamptz NOT NULL,
      "recordedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_belief_versions_belief_version_uniq
      ON ai_belief_versions ("beliefId", version)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_belief_versions_belief_recent_idx
      ON ai_belief_versions ("beliefId", version DESC)
  `)

  // ─────────────────────────── ai_provenance ────────────────────────────
  // One provenance chain per belief: the traces + inference path + distance.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_provenance (
      id bigserial PRIMARY KEY,
      "beliefId" bigint NOT NULL UNIQUE REFERENCES ai_beliefs(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "traceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "inferencePath" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "inferentialDistance" text NOT NULL DEFAULT 'low'
        CHECK ("inferentialDistance" IN ('low','medium','high')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_provenance_agency_idx
      ON ai_provenance ("agencyId")
  `)

  // ───────────────────────── ai_narrative_floor ─────────────────────────
  // Protected continuity of a relationship: history, promises, outcomes.
  // Append-only; exempt from pruning/consolidation (Constitution XI.7).
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_narrative_floor (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('history','promise','outcome')),
      content jsonb NOT NULL DEFAULT '{}'::jsonb,
      "occurredAt" timestamptz NOT NULL,
      "recordedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_narrative_floor_subject_time_idx
      ON ai_narrative_floor ("agencyId", "subjectType", "subjectId", "occurredAt")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_narrative_floor`)
  await knex.raw(`DROP TABLE IF EXISTS ai_provenance`)
  await knex.raw(`DROP TABLE IF EXISTS ai_belief_versions`)
  await knex.raw(`DROP TABLE IF EXISTS ai_beliefs`)
}
