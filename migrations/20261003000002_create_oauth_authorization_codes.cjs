/**
 * ChatGPT / MCP (Phase A) — OAuth authorization codes.
 *
 * Single-use, short-lived (OAuth 2.1 §4.1). ONLY THE HASH IS STORED: code_hash
 * is SHA-256 of the 32-byte random code, so a dump of this table yields nothing
 * redeemable. consumed_at is the replay signal — a second presentation revokes
 * the grant.
 *
 * request_jti is the jti of the server-validated pending-authorization cookie
 * that the consent decision consumed. UNIQUE, so one pending request can mint at
 * most one code: stale login state cannot replay an old authorization (D1).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('oauth_authorization_codes')) return

  await knex.schema.createTable('oauth_authorization_codes', (t) => {
    t.bigIncrements('id').primary()
    t.string('code_hash', 64).notNullable().unique()
    t.bigInteger('grant_id').notNullable().references('id').inTable('oauth_grants').onDelete('CASCADE')
    t.uuid('request_jti').notNullable().unique()
    t.text('client_id').notNullable()
    // The exact redirect_uri used at /authorize; the token request must repeat it.
    t.text('redirect_uri').notNullable()
    // PKCE S256 challenge (plain is never accepted).
    t.string('code_challenge', 128).notNullable()
    t.specificType('scopes', 'text[]').notNullable()
    t.text('resource').notNullable()
    t.timestamp('expires_at', { useTz: true }).notNullable()
    t.timestamp('consumed_at', { useTz: true })
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())

    // Drives the retention sweep.
    t.index(['expires_at'], 'oauth_codes_expires_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('oauth_authorization_codes')
}
