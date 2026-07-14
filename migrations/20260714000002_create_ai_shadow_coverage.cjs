/**
 * AI Runtime — Integration-3: shadow coverage-sweep decision sink.
 *
 * An isolated, additive table recording the shadow cognition produced by the
 * Tier-1 coverage sweep (time/coverage-driven, not message-driven). Separate from
 * Integration-2's turn-keyed ai_shadow_decisions because a sweep decision has no
 * conversation/turn and must be keyed per relationship per sweep window.
 *
 * Doctrine (mirrors the M1 substrate migration):
 *   - Additive only. No existing table/column is renamed, retyped, or dropped.
 *   - Isolated: no foreign key to any production table; truncate/drop independently.
 *   - Scope-first: every row carries "agencyId".
 *   - Idempotent per sweep window: unique (agencyId, subjectType, subjectId,
 *     sweepBucket) so a re-fired sweep upserts rather than duplicates.
 *   - Reversible: down() drops the table.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_shadow_coverage (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      reason text NOT NULL CHECK (reason IN ('coverage_sweep','staleness')),
      outcome text NOT NULL CHECK (outcome IN ('recommend','stay_silent','rejected')),
      emitted boolean NOT NULL,
      "rejectionBoundary" text,
      decision jsonb NOT NULL,
      "sweptAt" timestamptz NOT NULL,
      "sweepBucket" bigint NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  // Idempotency: one decision per (agency, subject, sweep window) — upsert target.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_shadow_coverage_bucket_uniq
      ON ai_shadow_coverage ("agencyId", "subjectType", "subjectId", "sweepBucket")
  `)
  // Query a subject's coverage history (inspection/comparison).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_shadow_coverage_subject_idx
      ON ai_shadow_coverage ("agencyId", "subjectType", "subjectId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_shadow_coverage`)
}
