/**
 * Session revocation support — `users.sessionVersion` (H-7).
 *
 * Sessions are stateless HS256 JWTs, so until now the only way to end one was
 * to wait for `exp`: deleting the cookie removes the browser's copy but does
 * not invalidate the token, and a copied token stayed valid for its full life.
 * This column is the server-side counter that makes revocation possible: the
 * session token carries the `sv` it was minted with, and a mismatch against the
 * user's current `sessionVersion` rejects the session. Incrementing the column
 * therefore signs that user out of every device.
 *
 * Doctrine:
 *   - Additive only. No existing column is renamed, retyped, or dropped.
 *   - Metadata-only: a constant DEFAULT 0 means Postgres does not rewrite the
 *     table, so apply is O(1) regardless of row count.
 *   - Backward compatible in both directions. Code deployed BEFORE this
 *     migration simply never selects the column; code deployed AFTER it, but
 *     rolled back to a build that ignores `sv`, keeps working because the
 *     claim is only compared when both sides are present (grace mode).
 *   - Reversible: down() drops the column. Dropping it does not lock anyone
 *     out — tokens carrying `sv` are simply no longer compared.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.integer('sessionVersion').notNullable().defaultTo(0)
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('sessionVersion')
  })
}
