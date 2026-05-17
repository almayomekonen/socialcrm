/**
 * Phase 1.5 of the billing architecture: invoice persistence.
 *
 * Three additive tables, no existing column touched:
 *   - bill_invoices          invoice header. Holds BOTH mutable drafts and
 *                            immutable issued invoices; behavior is gated by
 *                            docState. Carries every snapshot field plus the
 *                            projection cache columns.
 *   - bill_invoice_lines     line-item child rows. Frozen at issue time.
 *                            taxRate is FK + denormalized snapshot.
 *   - bill_invoice_versions  draft autosave history. NOT legal versioning —
 *                            issued invoices remain immutable and the
 *                            void/replace chain lives on
 *                            bill_invoices.replacedByInvoiceId.
 *
 * Doctrine:
 *   - Additive only.
 *   - Reversible: down() drops in reverse FK order.
 *   - leadId, billingProfileId, taxRateId all use ON DELETE RESTRICT —
 *     issued financial records must outlive the deletion of any referenced
 *     row. GDPR-style scrubbing is anonymization of snapshot fields,
 *     not row deletion.
 *   - bill_invoice_versions.invoiceId uses ON DELETE CASCADE because only
 *     drafts can ever be deleted; issued rows are RESTRICT-protected
 *     elsewhere.
 *   - The CHECK constraint bill_invoices_post_draft_invariants enforces
 *     the cross-axis state machine at the data layer: any non-draft row
 *     must carry numbering, issue timestamps, and a fulfillState.
 *   - Numbering uniqueness is enforced by a partial unique index over
 *     (agencyId, documentYear, documentNumber) WHERE docState != 'draft'.
 *     The bill_numbering_sequences row lock is the allocation primitive;
 *     this index is the safety net.
 *
 * Two-axis state model (behavioral spec §1):
 *   docState     ∈ {'draft','issued','voided','replaced'}     legal lifecycle
 *   fulfillState ∈ {'open','partial','paid','overdue','written_off'} money projection
 *
 * Drafts have fulfillState=NULL; issued rows always carry a value.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // ────────────────────────── bill_invoices ───────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_invoices (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      "billingProfileId" bigint NOT NULL REFERENCES bill_billing_profiles(id) ON DELETE RESTRICT,
      "createdByUserId" integer NOT NULL REFERENCES users(id),

      -- Two-axis lifecycle state.
      "docState" text NOT NULL DEFAULT 'draft'
        CHECK ("docState" IN ('draft','issued','voided','replaced')),
      "fulfillState" text
        CHECK ("fulfillState" IS NULL OR "fulfillState" IN ('open','partial','paid','overdue','written_off')),

      -- Numbering. NULL until issuance allocates from bill_numbering_sequences.
      "documentNumber" bigint,
      "documentYear" smallint,
      "issuedAt" timestamptz,
      "issuedByUserId" integer REFERENCES users(id),

      -- Dates.
      "dueAt" date,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),

      -- Currency / locale / FX snapshot. fxRate=1.0 for same-currency invoices.
      currency text NOT NULL DEFAULT 'ILS',
      locale text NOT NULL DEFAULT 'he',
      "fxRate" numeric(16,8) NOT NULL DEFAULT 1.0,

      -- Totals. Frozen at issue; recomputed on every draft save.
      "subtotalAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "taxAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "roundingAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "totalAmount" numeric(14,2) NOT NULL DEFAULT 0,

      -- Billing-profile snapshot. Drafts may carry empty strings; issuance
      -- populates them from the live profile. After issue these are frozen
      -- — application layer rejects updates.
      "legalNameSnapshot" text NOT NULL DEFAULT '',
      "taxIdSnapshot" text NOT NULL DEFAULT '',
      "addressSnapshot" text NOT NULL DEFAULT '',
      "citySnapshot" text NOT NULL DEFAULT '',
      "zipSnapshot" text NOT NULL DEFAULT '',
      "countrySnapshot" text NOT NULL DEFAULT 'IL',
      "emailSnapshot" text NOT NULL DEFAULT '',
      "phoneSnapshot" text NOT NULL DEFAULT '',

      -- Replacement chain. Self-referential. Set once at the moment this
      -- invoice is superseded by a corrected one; never reset.
      "replacedByInvoiceId" bigint REFERENCES bill_invoices(id),

      -- Internal-only notes. Not visible on the PDF; CAN be edited post-issue
      -- per the data spec's allowed-mutations list.
      "internalNotes" text NOT NULL DEFAULT '',

      -- Customer-facing footer text. Snapshotted onto the PDF; frozen at issue.
      "customerFooter" text NOT NULL DEFAULT '',

      -- Projection caches. Rebuildable from bill_financial_events (Phase 2).
      -- At issue time the application initializes outstandingAmount=totalAmount,
      -- lastEventAt=issuedAt; the rest stay NULL until events fire.
      "outstandingAmount" numeric(14,2),
      "lastEventAt" timestamptz,
      "lastProjectionAt" timestamptz,
      "lastViewedAt" timestamptz,
      "reminderCount" integer NOT NULL DEFAULT 0,
      "lastReminderAt" timestamptz,

      -- Forward-compat for a versioned templates table.
      "templateVersionId" smallint NOT NULL DEFAULT 1,

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

      -- Cross-axis invariant: non-draft rows MUST have full issuance data.
      -- Defense in depth on top of application-layer immutability.
      CONSTRAINT bill_invoices_post_draft_invariants CHECK (
        "docState" = 'draft'
        OR (
          "documentNumber" IS NOT NULL
          AND "documentYear" IS NOT NULL
          AND "issuedAt" IS NOT NULL
          AND "issuedByUserId" IS NOT NULL
          AND "fulfillState" IS NOT NULL
        )
      )
    )
  `)

  // Lead billing tab: newest invoices first per lead.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_invoices_agency_lead_created_idx
      ON bill_invoices ("agencyId", "leadId", "createdAt" DESC)
  `)

  // Collections / workspace queries by state + due date. Phase 2 collections
  // queries layer on top of this index.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_invoices_agency_docstate_dueat_idx
      ON bill_invoices ("agencyId", "docState", "dueAt")
  `)

  // Issued-invoice listings.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_invoices_agency_issued_idx
      ON bill_invoices ("agencyId", "issuedAt" DESC)
      WHERE "docState" != 'draft'
  `)

  // Numbering uniqueness — the safety net behind bill_numbering_sequences.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_invoices_agency_year_number_uniq
      ON bill_invoices ("agencyId", "documentYear", "documentNumber")
      WHERE "docState" != 'draft'
  `)

  // ───────────────────────── bill_invoice_lines ───────────────────────
  // Snapshot child rows. taxRate is double-tracked: FK for audit, percent
  // denormalized for display independence. Frozen at issue.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_invoice_lines (
      id bigserial PRIMARY KEY,
      "invoiceId" bigint NOT NULL REFERENCES bill_invoices(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "lineNumber" smallint NOT NULL
        CHECK ("lineNumber" >= 1),

      -- Line content. Snapshotted onto the line; frozen at issue.
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      quantity numeric(10,4) NOT NULL DEFAULT 1
        CHECK (quantity > 0),
      "unitPrice" numeric(14,4) NOT NULL DEFAULT 0,
      discount numeric(14,2) NOT NULL DEFAULT 0
        CHECK (discount >= 0),

      -- Tax rate: FK for audit, snapshotted percent for display.
      "taxRateId" bigint REFERENCES bill_tax_rates(id) ON DELETE RESTRICT,
      "taxRatePercentSnapshot" numeric(7,4) NOT NULL DEFAULT 0
        CHECK ("taxRatePercentSnapshot" >= 0),

      -- Computed totals. Persisted (no recompute-on-read doctrine).
      "lineSubtotal" numeric(14,2) NOT NULL DEFAULT 0,
      "lineTaxAmount" numeric(14,2) NOT NULL DEFAULT 0,
      "lineTotal" numeric(14,2) NOT NULL DEFAULT 0,

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Line ordering within an invoice is unique and serves all line lookups.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_invoice_lines_invoice_line_uniq
      ON bill_invoice_lines ("invoiceId", "lineNumber")
  `)

  // ──────────────────────── bill_invoice_versions ─────────────────────
  // Draft autosave history. NOT legal versioning. Cascades on draft delete.
  // Once an invoice is issued, the application stops appending — this table
  // is a draft-only surface.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_invoice_versions (
      id bigserial PRIMARY KEY,
      "invoiceId" bigint NOT NULL REFERENCES bill_invoices(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "versionNumber" smallint NOT NULL
        CHECK ("versionNumber" >= 1),
      "savedByUserId" integer NOT NULL REFERENCES users(id),
      reason text NOT NULL DEFAULT 'autosave'
        CHECK (reason IN ('autosave','manual_save','pre_issue')),

      -- Full invoice+lines state at save time. Application-defined shape.
      "snapshotPayload" jsonb NOT NULL,

      "savedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Per-invoice version uniqueness. The unique index also serves
  // "latest version first" reads via descending scan.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_invoice_versions_invoice_version_uniq
      ON bill_invoice_versions ("invoiceId", "versionNumber")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS bill_invoice_versions`)
  await knex.raw(`DROP TABLE IF EXISTS bill_invoice_lines`)
  await knex.raw(`DROP TABLE IF EXISTS bill_invoices`)
}
