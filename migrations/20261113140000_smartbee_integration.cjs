/**
 * SmartBee document issuing — the first provider of the Integration Core
 * (lib/integrations/core). Two tables, both agency-scoped.
 *
 * smartbee_connections — ONE row per agency: which SmartBee business it issues
 * through. `providerUserTokenEnc` is AES-GCM ciphertext from lib/crypto/secrets.ts,
 * never plaintext (SmartBee's providerUserToken does not expire). `ownerUserId`
 * is the only user who may approve a document. `businessType` decides which
 * document types SmartBee will accept (an עוסק פטור issues receipts only).
 * Written by scripts/smartbee/connect.ts, never by a screen.
 *
 * smartbee_documents — ONE row per approved document request, written BEFORE
 * SmartBee is called:
 *   · `providerMsgId` is SmartBee's permanent idempotency key. It is derived from
 *     the agent action and never regenerated for the same row, so a timeout or a
 *     crash re-sends the SAME id and SmartBee answers 95 (duplicate) instead of
 *     creating a second document.
 *   · `agentActionId` is unique: one approved card, one row.
 *   · `apiMessageId` is what SmartBee polls by; `documentId`, `docIndex`,
 *     `taxConfirmationNumber` and the PDF links are stored only from a 102.
 *   · `payment` is the payment the OWNER confirmed on the card (method, amount,
 *     date, details), with `approvedByUserId` / `approvedAt`. A customer's claim
 *     never reaches this column.
 *   · `requestSnapshot` is the request as sent, WITHOUT the providerUserToken.
 *   · `noticeState` claims the one WhatsApp message to the owner (never resent).
 *   · `resolution` settles a `stalled` row (SmartBee never confirmed): the
 *     connection OWNER checked SmartBee and approved, on a card, either
 *     `exists` (optionally with the number they saw) or `absent`. Until then
 *     the lead gets no new document. Who, when and through which approved
 *     action are recorded with it.
 *
 * Leads stay deletable: `leadId` is SET NULL, unlike bill_financial_events.
 * AGENCIES DO NOT: both tables RESTRICT the agency, so deleting an agency can
 * never silently delete its document history or its SmartBee designation (the
 * connection row is what keeps native issuance closed, lib/integrations/core/registry.ts).
 * Additive; down() refuses while either table holds a row.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS smartbee_connections (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL UNIQUE REFERENCES agencies(id) ON DELETE RESTRICT,
      "ownerUserId" integer NOT NULL REFERENCES users(id),
      environment text NOT NULL CHECK (environment IN ('test','production')),
      "providerUserTokenEnc" text NOT NULL,
      "businessType" text NOT NULL CHECK ("businessType" IN ('exempt','authorized','company')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','disconnected')),
      "lastVerifiedAt" timestamptz,
      "lastError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS smartbee_documents (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
      "connectionId" bigint NOT NULL REFERENCES smartbee_connections(id),
      "leadId" integer REFERENCES clients(id) ON DELETE SET NULL,
      "agentActionId" text NOT NULL UNIQUE,
      environment text NOT NULL CHECK (environment IN ('test','production')),
      "providerMsgId" text NOT NULL UNIQUE,
      "apiMessageId" text UNIQUE,
      "docType" text NOT NULL CHECK ("docType" IN ('Invoice','Receipt','InvoiceReceipt')),
      description text NOT NULL,
      "totalAmount" numeric(12,2) NOT NULL CHECK ("totalAmount" > 0),
      currency text NOT NULL DEFAULT 'ILS',
      "vatOption" text CHECK ("vatOption" IN ('NotInclude','Include','Free')),
      payment jsonb,
      "requestSnapshot" jsonb NOT NULL,
      "approvedByUserId" integer NOT NULL REFERENCES users(id),
      "approvedAt" timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','queued','created','draft','failed','stalled')),
      "resultCode" integer,
      "failureReason" text,
      "validationErrors" jsonb,
      "documentId" text,
      "docIndex" text,
      "taxConfirmationNumber" text,
      "linkToOriginal" text,
      "linkToCopy" text,
      "submitAttempts" integer NOT NULL DEFAULT 0,
      "pollAttempts" integer NOT NULL DEFAULT 0,
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lastAttemptAt" timestamptz,
      "completedAt" timestamptz,
      "noticeState" text CHECK ("noticeState" IN ('sending','sent','unknown','rejected','not_eligible')),
      resolution text CHECK (resolution IN ('exists','absent')),
      "resolvedByUserId" integer REFERENCES users(id),
      "resolvedAt" timestamptz,
      "resolvedDocIndex" text,
      "resolutionActionId" text UNIQUE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT smartbee_documents_created_has_result
        CHECK (status <> 'created' OR ("documentId" IS NOT NULL AND "docIndex" IS NOT NULL)),
      CONSTRAINT smartbee_documents_queued_has_message
        CHECK (status NOT IN ('queued','created','draft') OR "apiMessageId" IS NOT NULL),
      CONSTRAINT smartbee_documents_receipt_has_payment
        CHECK ("docType" = 'Invoice' OR payment IS NOT NULL),
      CONSTRAINT smartbee_documents_resolution_only_stalled
        CHECK (resolution IS NULL OR status = 'stalled'),
      CONSTRAINT smartbee_documents_resolution_recorded
        CHECK (resolution IS NULL OR ("resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolutionActionId" IS NOT NULL))
    )
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS smartbee_documents_due_idx
      ON smartbee_documents ("nextAttemptAt") WHERE status IN ('pending','queued')
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS smartbee_documents_agency_idx
      ON smartbee_documents ("agencyId", id DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const table of ['smartbee_documents', 'smartbee_connections']) {
    if (!(await knex.schema.hasTable(table))) continue
    // A connection row designates its agency as a SmartBee issuer; dropping it would re-open native issuance.
    if (await knex(table).first('id')) throw new Error(`${table} is not empty; refusing to drop it`)
  }
  await knex.raw('DROP TABLE IF EXISTS smartbee_documents')
  await knex.raw('DROP TABLE IF EXISTS smartbee_connections')
}
