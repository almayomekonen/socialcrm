/**
 * Registration hardening — `users.emailVerifiedAt` (H-8).
 *
 * Registration creates an account (and issues a session) for whatever email
 * address the caller types, with no proof of ownership. Because `email` is
 * unique, that both blocks the real owner from signing up AND sets up account
 * pre-hijacking: the attacker keeps a session on the account, and when the real
 * owner later signs in with a verified Google token or a magic link, both login
 * paths ADOPT that same account — so the attacker retains access to the
 * victim's workspace.
 *
 * This column records when ownership of the address was actually proven. The
 * login paths use it to detect a first-time proof and revoke every session
 * issued before it (via users.sessionVersion, H-7), which evicts a pre-hijacker
 * at the exact moment the legitimate owner takes the account.
 *
 * Doctrine:
 *   - Additive only; nullable, so the ALTER is metadata-only (no rewrite).
 *   - Existing accounts are backfilled to their createdAt: they predate this
 *     control and must NOT be treated as unverified, otherwise the next login
 *     of an established user would revoke their other devices.
 *   - Reversible: down() drops the column. Dropping it disables the
 *     revoke-on-first-verification behaviour but locks nobody out.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.timestamp('emailVerifiedAt', { useTz: true })
  })

  await knex('users')
    .whereNull('emailVerifiedAt')
    .update({ emailVerifiedAt: knex.raw('"createdAt"') })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('emailVerifiedAt')
  })
}
