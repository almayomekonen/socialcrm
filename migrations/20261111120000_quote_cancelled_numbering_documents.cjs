/**
 * Quotations P0: the `cancelled` status, quote numbering, and quote PDF records.
 *
 * Three additive changes. No column is renamed, retyped or dropped, and no
 * existing row can fail a widened constraint.
 *
 * 1. `sales_quotes.status` admits `cancelled` (status values are append-only).
 *    A quote can be cancelled from `draft` (no number yet) or from `ready`
 *    (already numbered, never sent), so the two constraints that assumed
 *    "every status after draft/ready was numbered AND sent" now exempt it.
 *    `cancelledAt` records the moment, the way `decidedAt` records an answer,
 *    and is required for a cancelled row. Nothing writes `cancelled` yet.
 *
 * 2. `bill_numbering_sequences.kind` admits `quote`. Quotes share the row-locked
 *    allocator; invoice and receipt sequences are separate rows keyed by kind,
 *    so their numbers are untouched. A quote number is a display identity, not a
 *    legal one.
 *
 * 3. `sales_quote_documents` — rendered quote PDFs. A SALES table on purpose:
 *    `bill_documents.invoiceId` is NOT NULL and RESTRICT because an invoice PDF
 *    is a legal artifact; loosening it for quotes would weaken that table. Same
 *    shape as `bill_documents`: append-only rows, one `isCurrent` per quote, and
 *    at most one render in flight per quote (enforced here, not by code).
 *
 * Reversible. down() refuses rather than destroys once a row uses a new value.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE sales_quotes ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz;

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_status_check;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_status_check
      CHECK (status IN ('draft','ready','sent','accepted','declined','expired','cancelled'));

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_post_draft_invariants;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_post_draft_invariants CHECK (
      status IN ('draft','cancelled')
      OR ("quoteNumber" IS NOT NULL AND "quoteYear" IS NOT NULL AND "readyAt" IS NOT NULL)
    );

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_sent_requires_timestamp;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_sent_requires_timestamp CHECK (
      status IN ('draft','ready','cancelled') OR "sentAt" IS NOT NULL
    );

    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_cancelled_requires_timestamp CHECK (
      status <> 'cancelled' OR "cancelledAt" IS NOT NULL
    );

    ALTER TABLE bill_numbering_sequences DROP CONSTRAINT IF EXISTS bill_numbering_sequences_kind_check;
    ALTER TABLE bill_numbering_sequences ADD CONSTRAINT bill_numbering_sequences_kind_check
      CHECK (kind IN ('invoice','receipt','quote'));
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_documents (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "quoteId" bigint NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'rendering'
        CHECK (status IN ('rendering','ready','failed')),
      -- The R2 object key (tenants/<agencyId>/quotes/<quoteId>/<uuid>.pdf). Chosen
      -- before rendering so a retry never overwrites an earlier object.
      path text NOT NULL,
      "contentHash" text,
      "byteSize" integer CHECK ("byteSize" IS NULL OR "byteSize" >= 0),
      "failureReason" text,
      "isCurrent" boolean NOT NULL DEFAULT false,
      "renderedByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "readyAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sales_quote_documents_ready_has_content CHECK (
        status <> 'ready' OR ("contentHash" IS NOT NULL AND "byteSize" IS NOT NULL AND "readyAt" IS NOT NULL)
      ),
      CONSTRAINT sales_quote_documents_current_is_ready CHECK (NOT "isCurrent" OR status = 'ready')
    )
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_documents_quote_current_uniq
      ON sales_quote_documents ("quoteId") WHERE "isCurrent" = true
  `)
  // A double tap or a retried job cannot start a second render of the same quote.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_documents_quote_rendering_uniq
      ON sales_quote_documents ("quoteId") WHERE status = 'rendering'
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quote_documents_agency_quote_created_idx
      ON sales_quote_documents ("agencyId", "quoteId", "createdAt" DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const { rows } = await knex.raw(`SELECT
    (SELECT count(*)::int FROM sales_quotes WHERE status = 'cancelled') AS cancelled,
    (SELECT count(*)::int FROM bill_numbering_sequences WHERE kind = 'quote') AS quote_seq`)
  if (rows[0].cancelled > 0 || rows[0].quote_seq > 0) {
    throw new Error('cancelled quotes or quote numbering rows exist; refusing to narrow the constraints')
  }

  await knex.raw(`DROP TABLE IF EXISTS sales_quote_documents`)
  await knex.raw(`
    ALTER TABLE bill_numbering_sequences DROP CONSTRAINT IF EXISTS bill_numbering_sequences_kind_check;
    ALTER TABLE bill_numbering_sequences ADD CONSTRAINT bill_numbering_sequences_kind_check
      CHECK (kind IN ('invoice','receipt'));

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_cancelled_requires_timestamp;

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_sent_requires_timestamp;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_sent_requires_timestamp CHECK (
      status IN ('draft','ready') OR "sentAt" IS NOT NULL
    );

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_post_draft_invariants;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_post_draft_invariants CHECK (
      status = 'draft'
      OR ("quoteNumber" IS NOT NULL AND "quoteYear" IS NOT NULL AND "readyAt" IS NOT NULL)
    );

    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_status_check;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_status_check
      CHECK (status IN ('draft','ready','sent','accepted','declined','expired'));

    ALTER TABLE sales_quotes DROP COLUMN IF EXISTS "cancelledAt";
  `)
}
