/**
 * Refresh-token store for the native mobile client.
 *
 * WHY A TABLE AT ALL. The web session is a single self-contained cookie JWT with
 * no server-side record, which is why the only revocation lever today is
 * `users.sessionVersion` — and bumping it signs out EVERY device at once. That
 * is acceptable for a browser and unacceptable for a phone: "sign out my lost
 * iPhone" must not sign the rep out of their desktop mid-shift. Per-device
 * revocation requires per-device state, so the state lives here.
 *
 * NOT A JWT. The refresh credential is opaque random bytes. A JWT refresh token
 * cannot be revoked before it expires without a lookup anyway, so the lookup is
 * the design rather than a workaround — and an opaque string carries no claims
 * to misread.
 *
 * ONLY THE HASH IS STORED. `token_hash` is SHA-256 of the credential. A dump of
 * this table therefore yields nothing replayable, exactly as password storage
 * works. The raw value exists only in the response body and in the device
 * keychain.
 *
 * ROTATION + REUSE DETECTION. Every refresh mints a new row and stamps `used_at`
 * on the old one. A token presented twice is either a clone or a replay, and the
 * honest response is to distrust the whole lineage: `family_id` groups every
 * token descended from one sign-in so the entire family can be revoked at once.
 * Without this, a stolen refresh token is a permanent silent session.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('mobile_refresh_tokens')
  if (exists) return

  await knex.schema.createTable('mobile_refresh_tokens', (t) => {
    t.bigIncrements('id').primary()
    t.integer('user_id').notNullable()

    // Groups every token descended from a single sign-in, so reuse detection can
    // revoke the lineage rather than just the one presented token.
    t.uuid('family_id').notNullable()

    // SHA-256 hex of the opaque credential. Unique so a duplicate insert is a
    // database-level error rather than two live tokens.
    t.string('token_hash', 64).notNullable().unique()

    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('expires_at', { useTz: true }).notNullable()

    // Set the moment the token is exchanged. A second presentation of a row that
    // already has `used_at` is the reuse signal.
    t.timestamp('used_at', { useTz: true })
    t.timestamp('revoked_at', { useTz: true })

    // Why the token died — for support, not for logic.
    t.string('revoked_reason', 32)

    // Device identity, so a rep can recognise their own sessions in a list.
    // `device_id` is client-supplied and therefore NOT trusted for authorization;
    // it labels a session, it never grants one.
    t.string('device_id', 128)
    t.string('device_name', 128)
    t.string('platform', 16)
    t.text('user_agent')
    t.string('ip', 64)

    t.index(['user_id'], 'mobile_refresh_tokens_user_idx')
    t.index(['family_id'], 'mobile_refresh_tokens_family_idx')
    // Drives the expiry sweep.
    t.index(['expires_at'], 'mobile_refresh_tokens_expires_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const exists = await knex.schema.hasTable('mobile_refresh_tokens')
  if (exists) await knex.schema.dropTable('mobile_refresh_tokens')
}
