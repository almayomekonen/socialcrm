/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS payments (
      id bigserial PRIMARY KEY,
      "transactionId" text NOT NULL UNIQUE,
      "agencyId" integer NOT NULL REFERENCES agencies(id),
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS payments`)
}
