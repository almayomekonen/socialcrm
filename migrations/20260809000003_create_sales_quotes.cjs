/**
 * Phase B0 of the quotation domain: the quote itself.
 *
 * Two additive tables, no existing column touched:
 *   - sales_quotes       the quote header, draft through decided
 *   - sales_quote_items  its snapshotted line items
 *
 * WHY NOT `bill_invoices`. The invoice table's
 * `bill_invoices_post_draft_invariants` CHECK requires every non-draft row to
 * carry a legal number, an issue timestamp, an issuer and a money state. A SENT
 * quote has none of those. Making a quote fit would mean weakening the
 * constraint that protects every invoice in the system. `billingProfileId` is
 * also NOT NULL there, which would force a legal billing identity onto a lead
 * who has agreed to nothing. Separate tables; shared INFRASTRUCTURE only.
 *
 * THE ONE LINE THAT SAYS WHAT THIS IS. `leadId` uses ON DELETE CASCADE — the
 * exact opposite of `bill_invoices.leadId`, which is RESTRICT because an issued
 * invoice is a legal record that must outlive lead deletion. A quote is a sales
 * artefact: if the lead is gone, so is the quote. That single word is what "not
 * a financial record" means in the schema.
 *
 * Doctrine:
 *   - Additive only; reversible; drops in reverse FK order.
 *   - Lifecycle is SINGLE-AXIS. No `fulfillState`: a quote has no outstanding
 *     amount, no overdue and no write-off. Modelling money state here would be
 *     the first step towards the accounting coupling this design exists to
 *     avoid.
 *   - `expired` is a declared status but nothing writes it in v1 — expiry is
 *     DERIVED at read time from `expiresAt` (lib/quotes/status.ts). The value
 *     is declared now so materialising it later is a write, not a migration.
 *   - Numbering columns exist and are enforced by the post-draft CHECK, but
 *     nothing allocates a number yet: B0 creates drafts only. The allocator
 *     (`allocateNumberInTransaction`) hard-rejects any kind but invoice/receipt,
 *     so reusing it is a deliberate three-line widening that belongs to the
 *     phase which implements the `ready` transition, not to this one.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  // ───────────────────────────── sales_quotes ─────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quotes (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      "createdByUserId" integer NOT NULL REFERENCES users(id),
      -- Who is responsible for chasing it. SET NULL because a quote outlives
      -- the rep who made it; the agency still owns the money.
      "ownerUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      -- Provenance only. SET NULL: archiving or removing a template must never
      -- take a quote already in a customer's inbox with it.
      "templateId" bigint REFERENCES sales_quote_templates(id) ON DELETE SET NULL,

      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','ready','sent','accepted','declined','expired')),

      -- Display identity, allocated at 'ready'. NOT a legal number: a quote
      -- carries no gap-free obligation to any tax authority.
      "quoteNumber" bigint,
      "quoteYear" smallint,

      title text NOT NULL DEFAULT '',
      currency text NOT NULL DEFAULT 'ILS',
      locale text NOT NULL DEFAULT 'he',

      -- Recomputed on every draft save; frozen at 'ready'. Optional lines are
      -- EXCLUDED from these figures (see sales_quote_items."isOptional").
      "subtotalAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "taxAmount"      numeric(14,2) NOT NULL DEFAULT 0,
      "discountAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "totalAmount"    numeric(14,2) NOT NULL DEFAULT 0,

      -- Recipient snapshot, taken from the LEAD. Deliberately NOT a
      -- bill_billing_profiles row: a quote is pre-legal, and creating a billing
      -- identity for someone who has agreed to nothing would pollute the
      -- profile table's one-active-per-lead invariant.
      "recipientNameSnapshot"  text NOT NULL DEFAULT '',
      "recipientEmailSnapshot" text NOT NULL DEFAULT '',
      "recipientPhoneSnapshot" text NOT NULL DEFAULT '',

      "introText" text NOT NULL DEFAULT '',
      "termsText" text NOT NULL DEFAULT '',
      -- Never rendered to the customer; editable at any status.
      "internalNotes" text NOT NULL DEFAULT '',

      -- Validity as a concrete date, resolved from the template's validityDays
      -- at creation. A date, not a timestamp: "valid until the 23rd" is a
      -- business-day question, answered in BUSINESS_TZ at read time.
      "expiresAt" date,

      "readyAt" timestamptz,
      "sentAt" timestamptz,
      "sentByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "decidedAt" timestamptz,
      "declineReason" text,

      -- Conversion is a RELATION, not a status: an accepted-but-uninvoiced
      -- quote is a work item (money won, not yet billed), and collapsing it
      -- into a 'converted' status would erase that queue. SET NULL, never
      -- RESTRICT — no invoice operation may be blocked by a quote pointing at
      -- it, so deleting a draft invoice simply clears the link.
      "convertedInvoiceId" bigint REFERENCES bill_invoices(id) ON DELETE SET NULL,
      "convertedAt" timestamptz,

      -- OPAQUE automation idempotency key. The quotation domain stores it and
      -- enforces uniqueness; it never parses it and knows nothing about what
      -- produced it. Deliberately NOT a foreign key to automation_definitions:
      -- an FK would make the sales domain depend on the automation schema, and
      -- the direction of that dependency is the whole point.
      "automationKey" text,

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),

      -- Deliberately WEAKER than the invoice's equivalent: a quote carries no
      -- issuer, no money state and no legal timestamp. It carries an identity
      -- and the moment its content froze.
      CONSTRAINT sales_quotes_post_draft_invariants CHECK (
        status = 'draft'
        OR ("quoteNumber" IS NOT NULL AND "quoteYear" IS NOT NULL AND "readyAt" IS NOT NULL)
      ),

      -- An outcome on a quote the customer never received is not a fact.
      CONSTRAINT sales_quotes_sent_requires_timestamp CHECK (
        status IN ('draft','ready') OR "sentAt" IS NOT NULL
      ),

      CONSTRAINT sales_quotes_decided_requires_timestamp CHECK (
        status NOT IN ('accepted','declined') OR "decidedAt" IS NOT NULL
      ),

      -- Only an accepted quote can have produced an invoice.
      CONSTRAINT sales_quotes_converted_requires_accept CHECK (
        "convertedInvoiceId" IS NULL OR status = 'accepted'
      )
    )
  `)

  // Lead documents tab: newest quotes first per lead.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quotes_agency_lead_created_idx
      ON sales_quotes ("agencyId", "leadId", "createdAt" DESC)
  `)

  // Open-quote and expiry queries. Partial: only quotes still awaiting or
  // holding an outcome are ever scanned this way.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quotes_agency_status_expires_idx
      ON sales_quotes ("agencyId", status, "expiresAt")
      WHERE status IN ('sent','accepted')
  `)

  // Display-number uniqueness once allocated. Drafts have none.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_agency_year_number_uniq
      ON sales_quotes ("agencyId", "quoteYear", "quoteNumber")
      WHERE status <> 'draft'
  `)

  /**
   * THE AUTOMATION IDEMPOTENCY GUARD.
   *
   * An automation executor creates a quote and then sends it. If the send
   * throws, the engine releases its send-once claim and retries the whole step
   * — which would create a SECOND quote for the same lead. This index is what
   * makes that impossible: the executor inserts with ON CONFLICT DO NOTHING on
   * this key and converges on the row that already exists.
   *
   * Partial-unique-when-set, so hand-made quotes (NULL key) are unaffected and
   * a lead can have as many of those as they like. Same shape as
   * bill_financial_events' idempotency index.
   */
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_agency_automation_key_uniq
      ON sales_quotes ("agencyId", "automationKey")
      WHERE "automationKey" IS NOT NULL
  `)

  // ─────────────────────────── sales_quote_items ───────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_items (
      id bigserial PRIMARY KEY,
      "quoteId" bigint NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "lineNumber" smallint NOT NULL
        CHECK ("lineNumber" >= 1),

      -- Snapshotted from the template at creation. A later template edit does
      -- NOT reach back into a quote already made: the customer was quoted a
      -- price and that price is now a fact about the conversation.
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      quantity numeric(10,4) NOT NULL DEFAULT 1
        CHECK (quantity > 0),
      "unitPrice" numeric(14,4) NOT NULL DEFAULT 0
        CHECK ("unitPrice" >= 0),
      discount numeric(14,2) NOT NULL DEFAULT 0
        CHECK (discount >= 0),

      -- Tax double-tracked exactly as bill_invoice_lines does it: FK for audit,
      -- percent denormalised so display never depends on the rate row still
      -- existing. RESTRICT so a rate in use cannot be deleted out from under a
      -- quote a customer is reading.
      "taxRateId" bigint REFERENCES bill_tax_rates(id) ON DELETE RESTRICT,
      "taxRatePercentSnapshot" numeric(7,4) NOT NULL DEFAULT 0
        CHECK ("taxRatePercentSnapshot" >= 0),

      -- Persisted, never recomputed on read (the billing doctrine).
      "lineSubtotal"  numeric(14,2) NOT NULL DEFAULT 0,
      "lineTaxAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "lineTotal"     numeric(14,2) NOT NULL DEFAULT 0,

      -- Carried from the template. An optional line shows its own totals but is
      -- excluded from the quote's.
      "isOptional" boolean NOT NULL DEFAULT false,

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_items_quote_line_uniq
      ON sales_quote_items ("quoteId", "lineNumber")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS sales_quote_items`)
  await knex.raw(`DROP TABLE IF EXISTS sales_quotes`)
}
