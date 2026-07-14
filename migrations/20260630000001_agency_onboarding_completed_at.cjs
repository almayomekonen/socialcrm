/**
 * Onboarding-completion flag — decouples the /activate gate from any integration.
 *
 * NULL  → account has not completed onboarding → gated to /activate (shown once).
 * set   → onboarding done; the user is never redirected to /activate again,
 *         regardless of which integrations they use (FB, WhatsApp, IG, imports…).
 *
 * Backfill: EVERY existing agency is marked onboarded (now()), so no current
 * customer is ever gated. Only agencies created after this migration start NULL.
 *
 * Additive, reversible. The gate code must deploy AFTER this runs in prod.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" timestamptz`)
  await knex.raw(`UPDATE agencies SET "onboardingCompletedAt" = now() WHERE "onboardingCompletedAt" IS NULL`)
}

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS "onboardingCompletedAt"`)
}
