/**
 * Quotes V2: a version on the quote and its PDF, one row per customer send, and
 * an append-only audit trail. Additive; no existing row changes meaning.
 *
 * 1. `sales_quotes.version` starts at 1 and moves only on an owner-approved edit.
 *    `sales_quote_documents.quoteVersion` says which version a PDF renders, so an
 *    approval can name one exact PDF of one exact version.
 *
 * 2. `sales_quote_deliveries` — one row per attempt to send a quote to its
 *    customer. The partial unique index is the duplicate-send guard, enforced by
 *    the database rather than by a check-then-insert: a quote has at most one
 *    delivery that is not `failed`. `unknown` (Meta may have accepted it) counts
 *    as live on purpose, so it can never be resent automatically.
 *    The customer's link is stored only as a SHA-256 of its token.
 *
 * 3. `sales_quote_events` — who did what to which version. Ids and codes only.
 *
 * Reversible. down() refuses rather than destroys once a customer send exists.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE sales_quotes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
    ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_version_positive CHECK (version >= 1);
    ALTER TABLE sales_quote_documents ADD COLUMN IF NOT EXISTS "quoteVersion" integer NOT NULL DEFAULT 1;
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_deliveries (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "quoteId" bigint NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
      "quoteVersion" integer NOT NULL,
      "documentId" bigint NOT NULL REFERENCES sales_quote_documents(id) ON DELETE CASCADE,
      "contentHash" text NOT NULL,
      "actionId" text NOT NULL UNIQUE,
      "leadId" integer NOT NULL,
      "approvedByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "customerPhoneE164" text NOT NULL,
      "businessPhoneNumberId" text NOT NULL,
      channel text NOT NULL CHECK (channel IN ('text','template')),
      state text NOT NULL DEFAULT 'sending'
        CHECK (state IN ('sending','accepted','delivered','read','failed','unknown')),
      wamid text,
      "failureCode" text,
      "linkTokenHash" text NOT NULL UNIQUE,
      "linkExpiresAt" timestamptz NOT NULL,
      "linkRevokedAt" timestamptz,
      "firstOpenedAt" timestamptz,
      "ownerNotifiedDeliveredAt" timestamptz,
      "ownerNotifiedFailedAt" timestamptz,
      "acceptedAt" timestamptz,
      "deliveredAt" timestamptz,
      "readAt" timestamptz,
      "failedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_deliveries_one_live_per_quote
      ON sales_quote_deliveries ("quoteId") WHERE state <> 'failed'
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_deliveries_agency_wamid_uniq
      ON sales_quote_deliveries ("agencyId", wamid) WHERE wamid IS NOT NULL
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quote_deliveries_agency_quote_idx
      ON sales_quote_deliveries ("agencyId", "quoteId", "createdAt" DESC)
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sales_quote_events (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "quoteId" bigint NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
      "quoteVersion" integer NOT NULL,
      type text NOT NULL,
      "actorUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "actionId" text,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sales_quote_events_agency_quote_created_idx
      ON sales_quote_events ("agencyId", "quoteId", "createdAt")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const { rows } = await knex.raw(`SELECT
    (SELECT count(*)::int FROM sales_quote_deliveries) AS deliveries,
    (SELECT count(*)::int FROM sales_quotes WHERE version > 1) AS edited`)
  if (rows[0].deliveries > 0 || rows[0].edited > 0) {
    throw new Error('quote deliveries or edited quote versions exist; refusing to drop their history')
  }

  await knex.raw(`DROP TABLE IF EXISTS sales_quote_events`)
  await knex.raw(`DROP TABLE IF EXISTS sales_quote_deliveries`)
  await knex.raw(`
    ALTER TABLE sales_quote_documents DROP COLUMN IF EXISTS "quoteVersion";
    ALTER TABLE sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_version_positive;
    ALTER TABLE sales_quotes DROP COLUMN IF EXISTS version;
  `)
}
