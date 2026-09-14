/**
 * Facebook ad reporting — the user access token that `ads_read` is granted to.
 *
 * WHY A NEW TABLE. Ad accounts are not Page assets: `/me/adaccounts` and
 * `/act_{id}/insights` are read with a USER access token, and the Page
 * connection deliberately never persisted one. The ad connection is its own
 * consent (the user chose to share ad performance), with its own lifecycle.
 *
 * STORAGE. `accessToken` is always sealed (`scm1.` + AES-256-GCM,
 * SECRETS_ENC_KEY) — there is no plaintext legacy for this table. The token is
 * a 60-day long-lived user token; `tokenExpiresAt` lets the UI ask for a
 * reconnect before reporting silently fails.
 *
 * SCOPE. One row per (agency, user). Reporting reads only the CURRENT user's
 * row, and every ad account id a request names is re-checked against that
 * token's own `/me/adaccounts` list before insights are read.
 *
 * ADDITIVE ONLY.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS facebook_ad_connections (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "accessToken" text NOT NULL,
      "grantedScopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "tokenExpiresAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS facebook_ad_connections_agency_user_uniq
      ON facebook_ad_connections ("agencyId", "userId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS facebook_ad_connections`)
}
