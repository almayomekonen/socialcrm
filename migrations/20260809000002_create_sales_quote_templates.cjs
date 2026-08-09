/**
 * Phase B0 of the quotation domain: quote templates.
 *
 * Two additive tables, no existing column touched:
 *   - sales_quote_templates       a named, reusable quote the business can send
 *   - sales_quote_template_items  its authoritative line items and prices
 *
 * WHY THIS TABLE EXISTS AT ALL. A quotation automation needs something to
 * quote. Without a stored, authoritative price list the only ways to fill a
 * quote are to leave it empty or to have a model invent an amount — and an
 * invented price is the one fabrication the care charter forbids outright
 * (Law 1). The template IS the price authority; nothing downstream may produce
 * a number that did not come from here.
 *
 * Doctrine:
 *   - `sales_` prefix, not `bill_`. The prefix IS the statement: a quote is a
 *     SALES artefact, not an accounting record. Nothing here is referenced by
 *     invoice code, and no invoice invariant is weakened.
 *   - Additive only. No existing column renamed, retyped or dropped.
 *   - Reversible: down() drops in reverse FK order.
 *   - Template items carry NO TAX RATE, deliberately. VAT is agency policy, not
 *     template data: it is resolved at quote-creation time from the agency's
 *     live `bill_tax_rates` row through `resolveActiveTaxRateForLine`, which
 *     also applies the business-type rule (עוסק פטור collects 0% regardless).
 *     Storing a rate here would mean a VAT change, or a business switching to
 *     exempt, silently produced illegal quotes until every template was edited
 *     by hand. Prices ARE stored, because the price is the thing a template
 *     exists to hold.
 *   - Archive, never delete: `state` mirrors `bill_billing_profiles.state`. A
 *     quote records `templateId`, so hard deletion would orphan the provenance
 *     of quotes already sent to customers.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  // ─────────────────────── sales_quote_templates ───────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_templates (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "createdByUserId" integer NOT NULL REFERENCES users(id),

      -- The picker label, internal. Distinct from the customer-facing title
      -- below: "חבילת אתר — 2026" is a useful shelf label and a poor document
      -- heading.
      name text NOT NULL,
      title text NOT NULL DEFAULT '',

      "introText" text NOT NULL DEFAULT '',
      "termsText" text NOT NULL DEFAULT '',

      currency text NOT NULL DEFAULT 'ILS',
      locale text NOT NULL DEFAULT 'he',

      -- Default validity window, copied onto the quote as a concrete date at
      -- creation. Bounded so a typo cannot produce a quote valid for a decade.
      "validityDays" smallint NOT NULL DEFAULT 14
        CHECK ("validityDays" >= 1 AND "validityDays" <= 90),

      state text NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','archived')),

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // The picker's query path: active templates for one agency, by name.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quote_templates_agency_state_name_idx
      ON sales_quote_templates ("agencyId", state, name)
  `)

  // Two live templates called the same thing is a picker the user cannot read.
  // Archived rows are exempt so a name can be retired and reused.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_templates_agency_name_uniq
      ON sales_quote_templates ("agencyId", name)
      WHERE state = 'active'
  `)

  // ───────────────────── sales_quote_template_items ─────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_template_items (
      id bigserial PRIMARY KEY,
      "templateId" bigint NOT NULL REFERENCES sales_quote_templates(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "lineNumber" smallint NOT NULL
        CHECK ("lineNumber" >= 1),

      title text NOT NULL,
      description text NOT NULL DEFAULT '',

      -- Same precision as bill_invoice_lines, so a template line copies onto a
      -- quote line and later onto an invoice line without a lossy conversion
      -- at either hop.
      quantity numeric(10,4) NOT NULL DEFAULT 1
        CHECK (quantity > 0),
      "unitPrice" numeric(14,4) NOT NULL DEFAULT 0
        CHECK ("unitPrice" >= 0),
      discount numeric(14,2) NOT NULL DEFAULT 0
        CHECK (discount >= 0),

      -- An upsell the customer may decline. Excluded from the quote's totals;
      -- the ONE structural difference between a quote line and an invoice line,
      -- and the reason quotes need their own item table rather than sharing one.
      "isOptional" boolean NOT NULL DEFAULT false,

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Ordering within a template is unique and serves every item read.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_template_items_template_line_uniq
      ON sales_quote_template_items ("templateId", "lineNumber")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS sales_quote_template_items`)
  await knex.raw(`DROP TABLE IF EXISTS sales_quote_templates`)
}
