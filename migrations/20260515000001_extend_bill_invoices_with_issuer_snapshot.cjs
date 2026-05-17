/**
 * Phase 2.1 — Issuer snapshot on bill_invoices.
 *
 * Extends bill_invoices with a parallel set of issuer-side snapshot
 * columns. Today bill_invoices already freezes the RECIPIENT side at
 * issue time (legalNameSnapshot, taxIdSnapshot, addressSnapshot, etc.
 * — set by db/billing/issueInvoice.ts inside the issuance transaction).
 * The ISSUER side — the agency's own legal identity — was still being
 * read live from the `agencies` row at render and send time, meaning
 * a rebrand or tax-ID correction silently mutated the appearance of
 * historical invoices. These columns close that hole.
 *
 * Mirrors the recipient-snapshot naming convention (suffix "Snapshot")
 * but prefixes with "issuer" to keep the two sides unambiguous in
 * queries and types:
 *
 *   recipient side (already exists):   legalNameSnapshot, taxIdSnapshot, ...
 *   issuer side    (this migration):   issuerNameSnapshot, issuerTaxIdSnapshot, ...
 *
 * Tier mapping (sourced from lib/billing/issuer/fields.ts):
 *   Tier 1 (required-to-issue): name, businessType, taxId
 *   Tier 2 (recommended):       address, phone, email
 *   Tier 3 (no UI day one):     country / currency / locale / docNumberFormat / bankDetails
 *                               — NOT snapshotted yet. Currency + locale are
 *                                 already invoice-level columns; the rest do
 *                                 not render anywhere today.
 *
 * Logo (`img`) is intentionally NOT snapshotted in this phase.
 * Historical guarantees for the logo require asset-lifecycle design
 * (the `files` row is freely deletable via actions/files.ts:deleteFile
 * with no referential check), not just a foreign-key column. The
 * decision was: a snapshot reference without lifecycle guarantees is
 * not a real snapshot. Logo snapshot is rolled into Priority 6
 * (PDF logo + richer email), where the render plumbing and the
 * lifecycle protection ship together.
 *
 * Doctrine:
 *   - Additive only. No existing column touched.
 *   - Reversible. down() drops all six columns.
 *   - No backfill. Legacy issued rows have empty snapshot strings;
 *     resolveIssuerForRender falls through to the live agency row,
 *     which is the same path the renderer uses today. Pre-migration
 *     render behavior is unchanged. Backfilling from current agency
 *     state would be wrong — it would assert "this is what the
 *     business looked like when issued," which we don't know.
 *   - The CHECK on issuerBusinessTypeSnapshot mirrors the one on
 *     agencies.businessType so the snapshot column accepts the same
 *     value set the source column does.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE bill_invoices
      -- Tier 1: required to issue. Non-empty after issuance by application contract.
      ADD COLUMN "issuerNameSnapshot" text NOT NULL DEFAULT '',
      ADD COLUMN "issuerBusinessTypeSnapshot" text
        CHECK ("issuerBusinessTypeSnapshot" IS NULL
               OR "issuerBusinessTypeSnapshot" IN ('exempt','authorized','company')),
      ADD COLUMN "issuerTaxIdSnapshot" text NOT NULL DEFAULT '',

      -- Tier 2: recommended. Empty string is "user didn't fill this".
      ADD COLUMN "issuerAddressSnapshot" text NOT NULL DEFAULT '',
      ADD COLUMN "issuerPhoneSnapshot" text NOT NULL DEFAULT '',
      ADD COLUMN "issuerEmailSnapshot" text NOT NULL DEFAULT ''
  `)
}

/**
 * Reversal drops the six new columns. Safe because nothing references
 * them and the application's resolver tolerates their absence (treats
 * an empty/missing snapshot as a fall-through to the live issuer).
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE bill_invoices
      DROP COLUMN IF EXISTS "issuerEmailSnapshot",
      DROP COLUMN IF EXISTS "issuerPhoneSnapshot",
      DROP COLUMN IF EXISTS "issuerAddressSnapshot",
      DROP COLUMN IF EXISTS "issuerTaxIdSnapshot",
      DROP COLUMN IF EXISTS "issuerBusinessTypeSnapshot",
      DROP COLUMN IF EXISTS "issuerNameSnapshot"
  `)
}
