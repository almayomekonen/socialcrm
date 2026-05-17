/**
 * Extend `agencies` with issuer-identity columns.
 *
 * Phase 1 of the "real business issuer" architecture. The agency
 * record IS the business for one-business-per-agency deployments —
 * these columns turn it from a SaaS subscription record into a
 * legal-document issuer.
 *
 * The shape of these columns is derived from lib/billing/issuer/fields.ts
 * (the field registry). Keep them in sync — the registry is the
 * source of truth, this migration follows from it.
 *
 * Tier classification (referenced from the audit):
 *   - Tier 1 (required to issue): businessType, taxId
 *     (`name` already exists on agencies — reused as the business name)
 *   - Tier 2 (recommended, optional): address, phone, email
 *     (`img` already exists — reused as the logo FK to files.id)
 *   - Tier 3 (no UI day one, sensible defaults): country, defaultCurrency,
 *     locale, docNumberFormat, bankDetails
 *
 * All new Tier 1+2 columns are NULLABLE — existing agencies start
 * empty and the issue gate prompts the user to fill them at first
 * issue. Tier 3 columns are NOT NULL with defaults to avoid NULL-
 * handling everywhere downstream.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE agencies
      -- Tier 1: required to issue. Nullable until the user fills them.
      ADD COLUMN "businessType" text
        CHECK ("businessType" IN ('exempt','authorized','company')),
      ADD COLUMN "taxId" text,

      -- Tier 2: recommended, never required. Optional forever.
      ADD COLUMN address text,
      ADD COLUMN phone text,
      ADD COLUMN email text,

      -- Tier 3: no UI day one. Defaults populate the column so the
      -- rest of the codebase never has to handle null.
      ADD COLUMN country text NOT NULL DEFAULT 'IL',
      ADD COLUMN "defaultCurrency" text NOT NULL DEFAULT 'ILS',
      ADD COLUMN locale text NOT NULL DEFAULT 'he',
      ADD COLUMN "docNumberFormat" text NOT NULL DEFAULT 'YYYY-NNNN',
      ADD COLUMN "bankDetails" jsonb NOT NULL DEFAULT '{}'::jsonb
  `)
}

/**
 * Reversal drops all the new columns. Safe because no foreign keys
 * reference them and Phase 1 introduces no new tables.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE agencies
      DROP COLUMN IF EXISTS "businessType",
      DROP COLUMN IF EXISTS "taxId",
      DROP COLUMN IF EXISTS address,
      DROP COLUMN IF EXISTS phone,
      DROP COLUMN IF EXISTS email,
      DROP COLUMN IF EXISTS country,
      DROP COLUMN IF EXISTS "defaultCurrency",
      DROP COLUMN IF EXISTS locale,
      DROP COLUMN IF EXISTS "docNumberFormat",
      DROP COLUMN IF EXISTS "bankDetails"
  `)
}
