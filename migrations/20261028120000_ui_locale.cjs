/**
 * Interface-language preferences (i18n Phase 1).
 *
 *   users."uiLocale"     — a person's explicit interface language
 *   agencies."uiLocale"  — the agency's default for users without one
 *
 * Both NULLABLE with NO default, and no backfill: NULL means "no explicit
 * choice", which resolves to Hebrew — exactly what every existing user sees
 * today. Applying this migration changes nothing anyone sees.
 *
 * Separate from `agencies.locale` on purpose: that column is the BILLING /
 * invoice document locale. The interface language must never change how an
 * invoice is issued, so the two concepts do not share a column.
 *
 * No CHECK constraint: the supported list (lib/i18n/config.ts) grows without a
 * migration, both server actions validate against it, and the resolver treats
 * any unrecognised stored value as "no preference".
 *
 * ADDITIVE: two nullable columns, metadata-only in Postgres (no table rewrite).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "uiLocale" text NULL`)
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "uiLocale" text NULL`)
}

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS "uiLocale"`)
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS "uiLocale"`)
}
