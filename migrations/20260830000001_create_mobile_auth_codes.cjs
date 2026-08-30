/**
 * Passwordless email sign-in for the MOBILE client, plus a generic auth throttle.
 *
 * WHY NOT REUSE `users.otp`. The web magic link stores one plaintext token per
 * user in that JSON column. Reusing it would mean (a) a mobile code request
 * silently invalidates a pending web magic link and vice versa, and (b) a code a
 * human types would sit in the database in the clear. This table keeps the two
 * flows independent and stores only a HASH.
 *
 * A 6-DIGIT CODE, NOT A LINK. Chosen over a magic link because the link would
 * need Universal Links (AASA hosting) or a custom scheme, and the emailed URL
 * would carry the credential through redirects and history. A typed code never
 * leaves the POST body.
 *
 * SIX DIGITS IS ONLY SAFE WITH LIMITS. 10^6 is trivially brute-forceable without
 * them, so the guarantees live here: `attempts` bounds guesses PER CODE, and
 * `mobile_auth_attempts` bounds requests per email and per IP.
 */
exports.up = async function (knex) {
  const hasCodes = await knex.schema.hasTable('mobile_auth_codes')
  if (!hasCodes) {
    await knex.schema.createTable('mobile_auth_codes', (t) => {
      t.bigIncrements('id').primary()

      // Normalised (lowercased/trimmed) — the same form `normalizeEmail` produces.
      t.string('email', 320).notNullable()

      // SHA-256 of the code. NEVER the code itself: a database reader must not be
      // able to complete someone else's sign-in.
      t.string('code_hash', 64).notNullable()

      t.timestamp('expires_at', { useTz: true }).notNullable()

      // Guesses spent against THIS code. Bounded so 10^6 cannot be walked.
      t.integer('attempts').notNullable().defaultTo(0)

      // Single-use. Set on success; a consumed row can never authenticate again.
      t.timestamp('consumed_at', { useTz: true })

      t.string('ip', 64)
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())

      // The verify path looks up the newest live code for an email.
      t.index(['email', 'created_at'], 'mobile_auth_codes_email_created_idx')
      // Drives expiry sweeps.
      t.index(['expires_at'], 'mobile_auth_codes_expires_idx')
    })
  }

  const hasAttempts = await knex.schema.hasTable('mobile_auth_attempts')
  if (!hasAttempts) {
    /**
     * One row per attempt, counted over a sliding window — the same shape as the
     * existing support-form limiter (`lib/support/rateLimit.ts`), which counts
     * rows rather than holding state in memory. In-memory counters are useless
     * here because serverless instances do not share them.
     */
    await knex.schema.createTable('mobile_auth_attempts', (t) => {
      t.bigIncrements('id').primary()
      // What is being limited: 'email_request' | 'email_verify' | 'register' | 'google' | 'facebook'
      t.string('kind', 32).notNullable()
      // The subject: normalised email, or `ip:<addr>`. Never a credential.
      t.string('subject', 320).notNullable()
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())

      t.index(['kind', 'subject', 'created_at'], 'mobile_auth_attempts_lookup_idx')
    })
  }
}

exports.down = async function (knex) {
  if (await knex.schema.hasTable('mobile_auth_attempts')) {
    await knex.schema.dropTable('mobile_auth_attempts')
  }
  if (await knex.schema.hasTable('mobile_auth_codes')) {
    await knex.schema.dropTable('mobile_auth_codes')
  }
}
