/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // Partial unique index — only enforces uniqueness when leadSource is non-null.
  // NULL rows (manually-added leads with no source) are excluded and remain unrestricted.
  // PostgreSQL's unique index engine makes this constraint atomic at the row level,
  // so concurrent INSERTs with the same leadSource will result in exactly one success
  // and one unique-violation error — no application-level locking required.
  await knex.raw(`
    CREATE UNIQUE INDEX clients_lead_source_unique
    ON clients ("leadSource")
    WHERE "leadSource" IS NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS clients_lead_source_unique`)
}
