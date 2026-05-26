/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS pending_upgrades (
      id          bigserial    PRIMARY KEY,
      "agencyId"  integer      NOT NULL REFERENCES agencies(id),
      email       varchar(255) NOT NULL,
      status      varchar(30)  NOT NULL DEFAULT 'pending',
      "createdAt" timestamptz  NOT NULL DEFAULT now(),
      "updatedAt" timestamptz  NOT NULL DEFAULT now(),
      UNIQUE ("agencyId")
    )
  `)
  await knex.raw('CREATE INDEX IF NOT EXISTS pending_upgrades_email_idx ON pending_upgrades(email)')
  await knex.raw('CREATE INDEX IF NOT EXISTS pending_upgrades_status_idx ON pending_upgrades(status)')
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS pending_upgrades')
}
