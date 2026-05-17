/**
 * Phase 4 of the billing architecture: document persistence.
 *
 * One additive table, no existing column touched:
 *   - bill_documents  rendered PDF artifacts per invoice. Versioned via
 *                     append-only rows; the "current" row per invoice is
 *                     identified by isCurrent=true (partial unique enforces
 *                     at most one current document per invoice).
 *
 * Doctrine:
 *   - Append-only with an isCurrent toggle. Historical renders remain in
 *     the table forever; the UI surfaces only the current one.
 *   - The invoice row remains the legal truth. This table is the
 *     projection-artifact ledger.
 *   - ON DELETE RESTRICT on invoiceId — issued invoices cannot be deleted
 *     while a document references them. The application layer prevents
 *     issued-invoice deletion anyway; this is defense in depth.
 *   - Status is a 3-state machine: rendering → (ready | failed). No
 *     "scheduled" state — the absence of any row IS the scheduled state.
 *   - The url column is populated by application code at upload time
 *     (s3PublicUrl + path). Not a generated column, because the URL
 *     prefix is environment-dependent and shouldn't be baked into SQL.
 *   - contentHash is a SHA-256 of the rendered bytes. Identical inputs
 *     produce identical hashes — useful for change detection and tamper
 *     evidence on re-render.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_documents (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "invoiceId" bigint NOT NULL REFERENCES bill_invoices(id) ON DELETE RESTRICT,
      kind text NOT NULL DEFAULT 'invoice_pdf'
        CHECK (kind IN ('invoice_pdf','receipt_pdf','statement_pdf')),
      locale text NOT NULL DEFAULT 'he',
      "templateVersionId" smallint NOT NULL DEFAULT 1,

      -- Storage location.
      path text,
      url text,

      -- Integrity + size — populated on transition to 'ready'.
      "contentHash" text,
      "byteSize" integer,

      -- Lifecycle.
      status text NOT NULL DEFAULT 'rendering'
        CHECK (status IN ('rendering','ready','failed')),
      "errorReason" text,

      -- Exactly one current document per invoice (partial unique below).
      "isCurrent" boolean NOT NULL DEFAULT false,

      "renderedAt" timestamptz,
      "renderedByUserId" integer REFERENCES users(id) ON DELETE SET NULL,

      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // At most one current document per invoice. The application code is
  // responsible for atomically demoting prior current rows when a new
  // render becomes ready (see db/billing/documents.ts).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_documents_invoice_current_uniq
      ON bill_documents ("invoiceId")
      WHERE "isCurrent" = true
  `)

  // Lookup-by-invoice ordering (newest first).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_documents_agency_invoice_created_idx
      ON bill_documents ("agencyId", "invoiceId", "createdAt" DESC)
  `)

  // Operational: find pending renders across the tenancy (for sweep jobs).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_documents_pending_idx
      ON bill_documents ("agencyId", "createdAt")
      WHERE status = 'rendering'
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS bill_documents`)
}
