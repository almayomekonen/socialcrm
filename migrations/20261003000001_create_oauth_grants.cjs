/**
 * ChatGPT / MCP (Phase A) — OAuth grants.
 *
 * One row = "this SocialCRM user authorized this OAuth client (identified by its
 * Client ID Metadata Document URL) to call this resource (the MCP endpoint)".
 * It is the anchor for disconnect: revoking a grant revokes its refresh tokens,
 * and every MCP request re-checks the grant, so access tokens that were already
 * issued die on their next use.
 *
 * NO FK INTO users/agencies, on purpose — existing tables stay untouched, the
 * same choice mobile_refresh_tokens made. Ownership is re-validated against
 * `users` on every request instead.
 *
 * session_version snapshots users.sessionVersion at consent, so "sign out
 * everywhere" (revokeUserSessions) also disconnects ChatGPT.
 *
 * At most ONE active grant per (user, client, resource): re-consent reuses the
 * row (scopes are unioned), enforced by a partial unique index.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('oauth_grants')) return

  await knex.schema.createTable('oauth_grants', (t) => {
    t.bigIncrements('id').primary()
    t.integer('user_id').notNullable()
    t.integer('agency_id').notNullable()
    // The CIMD URL, e.g. https://chatgpt.com/oauth/client.json.
    t.text('client_id').notNullable()
    // Snapshot of the document's client_name, for the disconnect UI only.
    t.string('client_name', 200).notNullable()
    // Canonical MCP URI the grant is bound to (RFC 8707).
    t.text('resource').notNullable()
    t.specificType('scopes', 'text[]').notNullable()
    t.integer('session_version').notNullable()
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('last_used_at', { useTz: true })
    t.timestamp('revoked_at', { useTz: true })
    // Why the grant died — for support, not for logic.
    t.string('revoked_reason', 32)

    t.index(['agency_id'], 'oauth_grants_agency_idx')
    t.index(['user_id'], 'oauth_grants_user_idx')
  })

  await knex.raw(
    'CREATE UNIQUE INDEX oauth_grants_one_active_idx ON oauth_grants (user_id, client_id, resource) WHERE revoked_at IS NULL',
  )
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('oauth_grants')
}
