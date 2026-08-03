/**
 * HOTFIX — `ON CONFLICT` could never match the connection identity index.
 *
 * B7 created the identity index as a PARTIAL unique index:
 *
 *   CREATE UNIQUE INDEX … ON automation_connections
 *     ("agencyId","integrationKey","externalId") WHERE "externalId" IS NOT NULL
 *
 * Postgres will only infer a partial index as the ON CONFLICT arbiter when the
 * statement carries a matching WHERE predicate on the conflict target. Knex's
 * `.onConflict([...]).merge()` emits none, so every provisioning attempt failed
 * with 42P10 `infer_arbiter_indexes`: "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification".
 *
 * The index was never wrong as a CONSTRAINT — it was wrong as an ARBITER. So
 * this drops the predicate rather than changing the columns.
 *
 * SEMANTICS ARE UNCHANGED. Postgres treats NULLs as distinct in a unique
 * index, so rows with a NULL `externalId` stay unconstrained exactly as the
 * `WHERE "externalId" IS NOT NULL` predicate intended. What changes is only
 * that the index is now inferable.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS automation_connections_identity_idx')
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_connections_identity_idx
      ON automation_connections ("agencyId", "integrationKey", "externalId")`)
}

/**
 * Restores the partial predicate. Reversible and non-destructive: both index
 * shapes reject exactly the same duplicate rows, so no data can be lost either
 * way — only the ability to infer the arbiter changes back.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS automation_connections_identity_idx')
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_connections_identity_idx
      ON automation_connections ("agencyId", "integrationKey", "externalId")
      WHERE "externalId" IS NOT NULL`)
}
