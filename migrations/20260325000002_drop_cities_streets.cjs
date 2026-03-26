/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.raw('DROP TABLE IF EXISTS "streets" CASCADE')
  await knex.schema.raw('DROP TABLE IF EXISTS "cities" CASCADE')
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  throw new Error('down() not implemented — cities and streets are legacy unused tables.')
}
