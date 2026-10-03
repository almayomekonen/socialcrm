/**
 * ChatGPT / MCP (Phase A) — rotating refresh tokens.
 *
 * Same security model as mobile_refresh_tokens: the credential is opaque random
 * bytes, only its SHA-256 is stored, every refresh mints a successor in the same
 * family_id and stamps used_at on the old row. A token presented twice is a clone
 * or a replay, so the whole family — and the grant — is revoked.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('oauth_refresh_tokens')) return

  await knex.schema.createTable('oauth_refresh_tokens', (t) => {
    t.bigIncrements('id').primary()
    t.bigInteger('grant_id').notNullable().references('id').inTable('oauth_grants').onDelete('CASCADE')
    // Denormalized for support queries and the sweep; authorization uses the grant.
    t.integer('user_id').notNullable()
    // Every token descended from one code exchange.
    t.uuid('family_id').notNullable()
    t.string('token_hash', 64).notNullable().unique()
    t.specificType('scopes', 'text[]').notNullable()
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('expires_at', { useTz: true }).notNullable()
    t.timestamp('used_at', { useTz: true })
    t.timestamp('revoked_at', { useTz: true })
    t.string('revoked_reason', 32)

    t.index(['grant_id'], 'oauth_refresh_grant_idx')
    t.index(['family_id'], 'oauth_refresh_family_idx')
    t.index(['expires_at'], 'oauth_refresh_expires_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('oauth_refresh_tokens')
}
