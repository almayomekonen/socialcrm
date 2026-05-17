/**
 * Phase 1 of the billing architecture: foundational primitives.
 *
 * Three additive tables, no existing column touched:
 *   - bill_billing_profiles    legal billing identity per (agency, lead)
 *   - bill_tax_rates           versioned tax/VAT rates; new rates = new rows
 *   - bill_numbering_sequences serialization point for gap-free invoice/receipt numbering
 *
 * Doctrine:
 *   - Additive only. No existing column renamed, retyped, or dropped.
 *   - Reversible: down() drops in reverse FK order.
 *   - `leadId` FKs use ON DELETE RESTRICT — issued financial records must outlive
 *     lead deletion. GDPR-style customer-data deletion is anonymization of
 *     snapshot fields, never row deletion. See billing/data spec §2.4.
 *   - Tax rates and billing profiles snapshot their values onto issued invoices
 *     at issue time; updates here do NOT retroactively mutate past invoices.
 *   - `bill_numbering_sequences` uses a composite PK because the triplet
 *     (agencyId, year, kind) IS the natural identifier — a surrogate id buys
 *     nothing and the only caller is the allocation transaction.
 *
 * Seeding:
 *   - Each existing agency gets one standard-VAT row (18% IL, effective from
 *     2024-01-01). Agencies created after this migration runs are handled
 *     lazily by getOrCreateDefaultTaxRate() in db/billing/taxRates.ts.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // ─────────────────────── bill_billing_profiles ──────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_billing_profiles (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      "createdByUserId" integer NOT NULL REFERENCES users(id),
      "legalName" text NOT NULL,
      "taxId" text,
      address text,
      city text,
      zip text,
      country text NOT NULL DEFAULT 'IL',
      email text,
      phone text,
      "defaultCurrency" text NOT NULL DEFAULT 'ILS',
      locale text NOT NULL DEFAULT 'he',
      state text NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','archived')),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // One active profile per (agency, lead). Archived profiles can coexist with
  // a new active one. Forward-compat for multi-business-per-lead: drop this
  // index and add a business-unit discriminator column.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_billing_profiles_active_per_lead_uniq
      ON bill_billing_profiles ("agencyId", "leadId")
      WHERE state = 'active'
  `)

  // Read index for the cross-state "all profiles for this lead" case.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_billing_profiles_agency_lead_idx
      ON bill_billing_profiles ("agencyId", "leadId")
  `)

  // ────────────────────────── bill_tax_rates ──────────────────────────
  // Versioned. New rate = new row. The application layer never UPDATEs an
  // active row's ratePercent; corrections are new rows with a new effectiveFrom.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_tax_rates (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      code text NOT NULL,
      label text NOT NULL,
      "ratePercent" numeric(7,4) NOT NULL
        CHECK ("ratePercent" >= 0),
      country text NOT NULL DEFAULT 'IL',
      "effectiveFrom" date NOT NULL,
      "effectiveTo" date,
      "createdByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // A given code can change over time, but never have two rows with the same
  // start date — that's the versioning contract.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_tax_rates_agency_code_from_uniq
      ON bill_tax_rates ("agencyId", code, "effectiveFrom")
  `)

  // Active-rate lookup: WHERE effectiveTo IS NULL OR effectiveTo > today.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_tax_rates_agency_active_idx
      ON bill_tax_rates ("agencyId", "effectiveTo")
  `)

  // Seed one standard Israeli VAT row per existing agency. New agencies after
  // this migration are seeded lazily on first billing use.
  await knex.raw(`
    INSERT INTO bill_tax_rates
      ("agencyId", code, label, "ratePercent", country, "effectiveFrom")
    SELECT id, 'VAT_STD', 'מע"מ סטנדרטי', 18.0000, 'IL', '2024-01-01'::date
    FROM agencies
    ON CONFLICT ("agencyId", code, "effectiveFrom") DO NOTHING
  `)

  // ─────────────────────── bill_numbering_sequences ───────────────────
  // The serialization point for legal numbering. SELECT ... FOR UPDATE on the
  // matching row is the only legitimate way to allocate a number. Composite PK
  // because the triplet IS the identifier.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_numbering_sequences (
      "agencyId" integer NOT NULL,
      year smallint NOT NULL,
      kind text NOT NULL
        CHECK (kind IN ('invoice','receipt')),
      "nextValue" bigint NOT NULL DEFAULT 1
        CHECK ("nextValue" >= 1),
      "lastIssuedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("agencyId", year, kind)
    )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS bill_numbering_sequences`)
  await knex.raw(`DROP TABLE IF EXISTS bill_tax_rates`)
  await knex.raw(`DROP TABLE IF EXISTS bill_billing_profiles`)
}
