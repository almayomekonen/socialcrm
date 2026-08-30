/**
 * Server-minted login nonces for MOBILE Facebook Limited Login.
 *
 * WHY A NEW TABLE RATHER THAN `mobile_auth_codes`. That table is keyed by a
 * NOT NULL `email` and carries a per-code `attempts` budget, because a 6-digit
 * code is guessable and must be rate-bound per address. A login nonce has
 * neither property: it is issued before any identity is known (there is no email
 * to key on), and it is 256 bits of CSPRNG output, so a guess ceiling would
 * protect nothing. Forcing it into that table would mean a synthetic email and a
 * meaningless attempts column, and would let a nonce request silently supersede
 * a pending email code — the two flows must stay independent.
 *
 * WHAT THE NONCE IS FOR. iOS Facebook Login returns a Limited Login OIDC token
 * whose `nonce` claim echoes a value supplied at login time. If the server does
 * not choose that value, it cannot bind the token to a request it issued, and any
 * captured token is replayable for the life of the token — which Meta currently
 * mints at 90 days. The nonce is what makes that token single-use.
 *
 * ONLY A HASH IS STORED, and unlike `mobile_auth_codes` the lookup is BY hash
 * rather than by a subject key. A 256-bit value cannot be brute-forced from the
 * digest, so there is no attempt ceiling here and no constant-time compare: the
 * unique index does an exact match on the digest, and a database reader still
 * cannot reconstruct a usable nonce.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('mobile_auth_nonces')
  if (exists) return

  await knex.schema.createTable('mobile_auth_nonces', (t) => {
    t.bigIncrements('id').primary()

    /**
     * SHA-256 of the nonce, hex. NEVER the nonce itself.
     *
     * UNIQUE for two reasons: it makes collision impossible to ignore silently,
     * and it is the lookup key on the consume path, so the index is required
     * regardless.
     */
    t.string('nonce_hash', 64).notNullable().unique()

    t.timestamp('expires_at', { useTz: true }).notNullable()

    // Single use. Set the moment the nonce is spent; a consumed row can never
    // authenticate again, which is what stops OIDC token replay.
    t.timestamp('consumed_at', { useTz: true })

    // Diagnostic only — never a limit key. Throttling lives in
    // `mobile_auth_attempts`, which already stores `ip:` subjects.
    t.string('ip', 64)

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())

    // Drives expiry sweeps of dead rows.
    t.index(['expires_at'], 'mobile_auth_nonces_expires_idx')
  })
}

exports.down = async function (knex) {
  if (await knex.schema.hasTable('mobile_auth_nonces')) {
    await knex.schema.dropTable('mobile_auth_nonces')
  }
}
