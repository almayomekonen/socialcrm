/**
 * ai_shadow_coverage.reason — admit 'absence'.
 *
 * The sink was created for the Tier-1 coverage sweep, whose only two admission
 * reasons are `coverage_sweep` and `staleness`, so its CHECK enumerates exactly
 * those. Phase 1 of the Signal work feeds the SAME read spine from a different
 * door: a deterministic CRM detector emits an `absence` ExternalSignal, and
 * `RuntimeScheduler.admit()` returns a request whose reason is `'absence'`
 * (lib/ai/runtime/scheduler.ts — `event.kind === 'absence_detected' ? 'absence'
 * : 'inbound'`).
 *
 * Recording that decision under either existing value would state a trigger
 * that did not occur, in the one table whose entire purpose is offline audit of
 * WHY cognition ran. So the vocabulary widens by one member rather than the
 * truth bending to fit it.
 *
 * Additive and reason-only: no column, index, default or row is touched, and
 * every existing row still satisfies the new constraint. `'inbound'` is
 * deliberately NOT added — nothing writes it, and an unused vocabulary member
 * is a claim the sink cannot back.
 *
 * DOWN is honest about its own limit: it restores the original two-value CHECK,
 * which Postgres will refuse while any `absence` row exists. That is correct —
 * rolling back the vocabulary must not silently delete or rewrite audit rows.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE ai_shadow_coverage DROP CONSTRAINT IF EXISTS ai_shadow_coverage_reason_check`)
  await knex.raw(`
    ALTER TABLE ai_shadow_coverage
      ADD CONSTRAINT ai_shadow_coverage_reason_check
      CHECK (reason IN ('coverage_sweep','staleness','absence'))
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE ai_shadow_coverage DROP CONSTRAINT IF EXISTS ai_shadow_coverage_reason_check`)
  await knex.raw(`
    ALTER TABLE ai_shadow_coverage
      ADD CONSTRAINT ai_shadow_coverage_reason_check
      CHECK (reason IN ('coverage_sweep','staleness'))
  `)
}
