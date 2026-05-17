/**
 * Phase 2 of the billing architecture: the append-only financial event spine.
 *
 * One additive table, no existing column touched:
 *   - bill_financial_events  immutable domain/operational/audit event log
 *
 * Doctrine:
 *   - Append-only forever. The application layer never writes UPDATE or
 *     DELETE against this table. Compensating facts are NEW rows, never
 *     edits to old rows.
 *   - One spine, three visibility tiers. The `visibilityTier` column
 *     distinguishes user-visible timeline events from system operational
 *     metadata from audit-only records. Consumers filter by tier; one source
 *     answers "show me everything that touched this invoice."
 *   - Entity references use real nullable FKs, not (entityKind, entityId)
 *     polymorphism. FK integrity matters in a financial table. Future
 *     entities (receipts, allocations) get their own nullable FK columns
 *     added additively.
 *   - `invoiceId` cascades on delete because only drafts are deletable; the
 *     application layer prevents deletion of issued invoices, so CASCADE
 *     never fires for legal-weight rows.
 *   - `leadId` is RESTRICT — events outlive any lead deletion attempt.
 *     GDPR-style scrubbing is anonymization of snapshot fields, not row
 *     deletion.
 *   - `actorUserId` is SET NULL — events outlive user deletion. The
 *     `actorKind` column still records *what kind* of actor it was, even
 *     after the user row is gone.
 *   - Idempotency is partial-unique on (agencyId, idempotencyKey) — applies
 *     only when the key is set (webhook ingest path in Phase 2.5+).
 *   - The CHECK constraint bill_financial_events_entity_required enforces
 *     that every row references something. No floating events.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS bill_financial_events (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,

      -- Entity references. At least one must be set (CHECK below).
      -- Future entity FKs (receiptId, allocationId, paymentIntentId) land as
      -- additive nullable columns when those entities are introduced.
      "invoiceId" bigint REFERENCES bill_invoices(id) ON DELETE CASCADE,
      "leadId" integer REFERENCES clients(id) ON DELETE RESTRICT,

      -- Actor attribution. NULL actorUserId is valid for system/projection
      -- events and for events whose original user has since been deleted.
      "actorUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "actorKind" text NOT NULL
        CHECK ("actorKind" IN ('user','system','webhook','projection')),

      -- The verb. Hierarchical string like 'invoice.issued',
      -- 'projection.fulfill_state_recomputed'. Defined as constants in
      -- lib/billing/events/eventTypes.ts.
      "eventType" text NOT NULL,

      -- Three-tier visibility for the timeline UI.
      "visibilityTier" text NOT NULL
        CHECK ("visibilityTier" IN ('user','system','audit')),

      -- Temporal split: occurredAt is the logical fact time (e.g. when the
      -- payment was made); recordedAt is when this row was inserted. Usually
      -- equal, but differ for backfills and async webhook ingests.
      "occurredAt" timestamptz NOT NULL,
      "recordedAt" timestamptz NOT NULL DEFAULT now(),

      -- Event-type-specific structured data (amounts, references, snapshots).
      -- Shape is application-defined per eventType; the column is permissive.
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,

      -- Webhook dedup key. NULL for user-driven events. Unique-when-set per
      -- agency via the partial index below.
      "idempotencyKey" text,

      -- Forward-compat envelope: request_id, source_ip, etc.
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

      CONSTRAINT bill_financial_events_entity_required CHECK (
        "invoiceId" IS NOT NULL OR "leadId" IS NOT NULL
      )
    )
  `)

  // Invoice-scoped query path: timeline UI + projection rebuild.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_financial_events_agency_invoice_occurred_idx
      ON bill_financial_events ("agencyId", "invoiceId", "occurredAt" DESC)
      WHERE "invoiceId" IS NOT NULL
  `)

  // Lead-scoped cross-invoice query path.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS bill_financial_events_agency_lead_occurred_idx
      ON bill_financial_events ("agencyId", "leadId", "occurredAt" DESC)
      WHERE "leadId" IS NOT NULL
  `)

  // Webhook dedup: partial unique so user-driven (null-key) rows are unaffected.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bill_financial_events_agency_idempotency_uniq
      ON bill_financial_events ("agencyId", "idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS bill_financial_events`)
}
