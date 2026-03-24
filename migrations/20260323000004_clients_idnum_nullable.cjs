/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE clients ALTER COLUMN "idNum" DROP NOT NULL`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE clients ALTER COLUMN "idNum" SET NOT NULL`)
}
