/**
 * Quotes V2: an email invitation to continue on WhatsApp, for a quote the owner
 * approved while WhatsApp could not reach the customer (service window closed,
 * no approved template). lib/waAssistant/quotes/emailInvite.ts.
 *
 * One row = one DURABLE delivery authorization, born from one approved
 * `send_quote` action (`actionId`, unique). It binds exactly what the owner
 * approved: the quote version, the PDF and its hash, the amount, the lead, the
 * customer's number, the business number and the email address (as a SHA-256 of
 * the normalized address, never the address itself). The reference inside the
 * WhatsApp message the customer sends back is stored only as a SHA-256 too.
 *
 * An invitation is NOT a delivery. `sales_quote_deliveries` still holds the only
 * record of a quote reaching a customer; `deliveryId` points to it once the
 * customer has written and the quote went out on WhatsApp.
 *
 *   sending → sent | failed | unknown      the email itself
 *   sent | unknown → redeemed               the customer wrote on WhatsApp (single use)
 *   sending | sent | unknown → invalidated  refused at redemption (changed, cancelled, expired …)
 *
 * The partial unique index is the duplicate-invitation guard, by the database:
 * one live invitation per agency, quote, version and address. A `failed` email
 * does not count, so a new approval may try again.
 *
 * Additive; reversible. down() refuses once an invitation exists.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_invitations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "quoteId" bigint NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
      "quoteVersion" integer NOT NULL,
      "documentId" bigint NOT NULL REFERENCES sales_quote_documents(id) ON DELETE CASCADE,
      "contentHash" text NOT NULL,
      "totalAmount" numeric(14,2) NOT NULL,
      "actionId" text NOT NULL UNIQUE,
      "leadId" integer NOT NULL,
      "approvedByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "customerPhoneE164" text NOT NULL,
      "businessPhoneNumberId" text NOT NULL,
      "emailHash" text NOT NULL,
      "refHash" text NOT NULL UNIQUE,
      state text NOT NULL DEFAULT 'sending'
        CHECK (state IN ('sending','sent','failed','unknown','redeemed','invalidated')),
      "providerMessageId" text,
      "failureCode" text,
      "invalidReason" text,
      "authorizationExpiresAt" timestamptz NOT NULL,
      "deliveryId" bigint REFERENCES sales_quote_deliveries(id) ON DELETE SET NULL,
      "emailSentAt" timestamptz,
      "redeemedAt" timestamptz,
      "invalidatedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_invitations_one_live_per_address
      ON sales_quote_invitations ("agencyId", "quoteId", "quoteVersion", "emailHash") WHERE state <> 'failed'
  `)
  // Bounce and complaint events find their invitation by Resend's message id (app/api/automations/email-events).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_invitations_provider_message_uniq
      ON sales_quote_invitations ("providerMessageId") WHERE "providerMessageId" IS NOT NULL
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quote_invitations_agency_quote_idx
      ON sales_quote_invitations ("agencyId", "quoteId", "createdAt" DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const { rows } = await knex.raw(`SELECT count(*)::int AS n FROM sales_quote_invitations`)
  if (rows[0].n > 0) throw new Error('quote invitations exist; refusing to drop their history')
  await knex.raw(`DROP TABLE IF EXISTS sales_quote_invitations`)
}
