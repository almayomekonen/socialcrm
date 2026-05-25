/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                  bigserial    PRIMARY KEY,
      "agencyId"          integer      NOT NULL REFERENCES agencies(id),
      "planStartedAt"     timestamptz,
      "expiresAt"         timestamptz,
      "cancelAtPeriodEnd" boolean      NOT NULL DEFAULT false,
      "createdAt"         timestamptz  NOT NULL DEFAULT now(),
      "updatedAt"         timestamptz  NOT NULL DEFAULT now(),
      UNIQUE ("agencyId")
    )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS subscriptions`)
}
