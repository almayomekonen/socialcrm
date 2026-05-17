/**
 * Phase 1 of "חשבונית/קבלה" (combined invoice + receipt).
 *
 * One additive change on bill_invoices: adds a `kind` discriminator and
 * the payment-received fields (live + snapshot mirrors). No new tables,
 * no FKs, no renames, no retypes.
 *
 * Doctrine:
 *   - Additive only. Existing invoices default to kind='invoice' — behavior
 *     identical to today.
 *   - Reversible. down() drops in reverse order.
 *   - Snapshot pattern mirrors recipient + issuer snapshots already on this
 *     table: live columns are draft-mutable; *Snapshot columns are frozen at
 *     issue time and become the legal truth.
 *   - The CHECK constraint enforces: any non-draft row with kind='invoice_receipt'
 *     MUST carry full payment-snapshot data. Defense in depth on top of
 *     application-layer immutability.
 *   - Numbering reuses the existing 'invoice' kind in bill_numbering_sequences.
 *     A combined doc is one document with one number, per Israeli practice.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE bill_invoices
      -- Document flavor. Default keeps existing rows behaving exactly as today.
      ADD COLUMN kind text NOT NULL DEFAULT 'invoice'
        CHECK (kind IN ('invoice','invoice_receipt')),

      -- Live (draft-mutable) payment fields. Populated only when
      -- kind='invoice_receipt'. NULL for plain invoices.
      ADD COLUMN "paymentMethod" text
        CHECK ("paymentMethod" IS NULL OR "paymentMethod" IN
          ('cash','bank_transfer','check','credit_card','digital','other')),
      ADD COLUMN "paymentAmount" numeric(14,2),
      ADD COLUMN "paymentDate" date,
      ADD COLUMN "paymentReceived" boolean NOT NULL DEFAULT false,

      -- Snapshot mirrors. Frozen at issue. Empty string / NULL for plain invoices.
      ADD COLUMN "paymentMethodSnapshot" text NOT NULL DEFAULT '',
      ADD COLUMN "paymentAmountSnapshot" numeric(14,2),
      ADD COLUMN "paymentDateSnapshot" date,

      -- Cross-axis invariant: an issued combined document must carry a
      -- complete payment snapshot. Drafts and plain-invoice issuances
      -- are unaffected.
      ADD CONSTRAINT bill_invoices_invoice_receipt_payment_invariants CHECK (
        "docState" = 'draft'
        OR kind <> 'invoice_receipt'
        OR (
          "paymentReceived" = true
          AND "paymentMethodSnapshot" <> ''
          AND "paymentAmountSnapshot" IS NOT NULL
          AND "paymentDateSnapshot" IS NOT NULL
        )
      )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE bill_invoices
      DROP CONSTRAINT IF EXISTS bill_invoices_invoice_receipt_payment_invariants,
      DROP COLUMN IF EXISTS "paymentDateSnapshot",
      DROP COLUMN IF EXISTS "paymentAmountSnapshot",
      DROP COLUMN IF EXISTS "paymentMethodSnapshot",
      DROP COLUMN IF EXISTS "paymentReceived",
      DROP COLUMN IF EXISTS "paymentDate",
      DROP COLUMN IF EXISTS "paymentAmount",
      DROP COLUMN IF EXISTS "paymentMethod",
      DROP COLUMN IF EXISTS kind
  `)
}
