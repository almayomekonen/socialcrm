/**
 * Meta Ads intelligence — remembered account choice and a snapshot cache.
 *
 * facebook_ad_connections."selectedAccountId" (nullable)
 *   The ad account the user last chose. Remembered so the report opens on it,
 *   NEVER trusted: every use re-checks it against the accounts Meta lists for
 *   this connection's own token (`/me/adaccounts`). NULL = no choice yet.
 *
 * meta_ads_snapshots
 *   Meta's own answers, kept so the report renders without a Graph round trip
 *   on every view and still shows (labelled stale) data when Meta is briefly
 *   unavailable. Deliberately NOT a mirror of campaigns/ads and NOT daily rows
 *   to be summed: Meta resolves each date range itself (reach and frequency are
 *   deduplicated per range, rates are per row), so a range is cached as the
 *   answer Meta gave for that range — never rebuilt from parts.
 *
 *   One row per (agencyId, accountId, kind, key). `kind` is what was asked
 *   ('report' | 'breakdown' | 'top_ads' | 'creative' | 'account'); `key` names
 *   the exact question (range, drill-down ids, ad id). The payload holds Meta's
 *   numbers and names only — never a token.
 *
 * TENANCY. "agencyId" is part of the unique key and of every read; a cached
 *   row is only ever served after the account was verified for THIS
 *   connection's token, or for the connection's own remembered account during a
 *   transient Meta outage (never after an auth/permission failure).
 *
 * ADDITIVE ONLY: one nullable column, one new table.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('facebook_ad_connections', 'selectedAccountId'))) {
    await knex.raw(`ALTER TABLE facebook_ad_connections ADD COLUMN "selectedAccountId" text`)
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS meta_ads_snapshots (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "accountId" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('report','breakdown','top_ads','creative','account')),
      key text NOT NULL,
      payload jsonb NOT NULL,
      "fetchedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS meta_ads_snapshots_scope_uniq
      ON meta_ads_snapshots ("agencyId", "accountId", kind, key)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS meta_ads_snapshots`)
  await knex.raw(`ALTER TABLE facebook_ad_connections DROP COLUMN IF EXISTS "selectedAccountId"`)
}
