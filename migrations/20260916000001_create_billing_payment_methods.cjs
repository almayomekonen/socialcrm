/**
 * billing_payment_methods — the Grow card token that pays for a Social CRM
 * subscription (card-required trial, spec 2026-09-15).
 *
 * One row per card-setup ATTEMPT. `pending` rows are Grow "Get Token Only"
 * processes the customer may never finish; the single `active` row per agency
 * is the card on file. Replaced/invalid/removed/needs_review rows are kept for
 * audit. Starting a new setup invalidates older pending ones, and a
 * cancellation invalidates every pending one, so a late callback can never
 * revive what the customer has since replaced or cancelled.
 *
 * SECRETS. `setupProcessToken`, `setupTransactionToken` and `cardToken` hold
 * AES-GCM ciphertext from lib/crypto/secrets.ts, never plaintext. Grow forbids
 * revealing processToken/transactionToken to the payer; the card token is the
 * ability to charge the customer.
 *
 * TERMS. A trial start or reactivation records the subscription terms the
 * customer accepted; replacing the card on an existing subscription does not
 * change the agreement, so those rows may leave the terms columns empty.
 *
 * `lastVerificationError` records why a received callback could not (yet) be
 * verified with Grow — the row stays pending and nothing is activated.
 *
 * Additive and reversible. No existing table is touched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS billing_payment_methods (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL REFERENCES agencies(id),
      "createdByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      provider text NOT NULL DEFAULT 'grow' CHECK (provider IN ('grow')),
      "providerMode" text NOT NULL CHECK ("providerMode" IN ('sandbox','production')),
      purpose text NOT NULL CHECK (purpose IN ('trial_start','card_update','reactivate')),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','active','replaced','invalid','removed','needs_review')),
      reference text NOT NULL UNIQUE,
      "holderFullName" text NOT NULL,
      "holderPhone" text NOT NULL,
      "holderEmail" text,
      "termsVersion" text,
      "termsAcceptedAt" timestamptz,
      "setupProcessId" text,
      "setupProcessToken" text,
      "setupTransactionId" text,
      "setupTransactionToken" text,
      "setupStatusCode" text,
      "cardToken" text,
      "cardSuffix" text,
      "cardBrand" text,
      "cardExp" text,
      "confirmedAt" timestamptz,
      "invalidatedAt" timestamptz,
      "invalidReason" text,
      "lastCallbackAt" timestamptz,
      "lastVerificationError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT billing_payment_methods_active_has_token
        CHECK (status <> 'active' OR ("cardToken" IS NOT NULL AND "confirmedAt" IS NOT NULL)),
      CONSTRAINT billing_payment_methods_terms_recorded
        CHECK (purpose = 'card_update' OR ("termsVersion" IS NOT NULL AND "termsAcceptedAt" IS NOT NULL))
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_methods_process_uniq
      ON billing_payment_methods (provider, "setupProcessId") WHERE "setupProcessId" IS NOT NULL
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_methods_active_per_agency_uniq
      ON billing_payment_methods ("agencyId") WHERE status = 'active'
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS billing_payment_methods_agency_idx
      ON billing_payment_methods ("agencyId", id DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS billing_payment_methods`)
}
