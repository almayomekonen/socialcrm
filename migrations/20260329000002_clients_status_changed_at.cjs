/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('clients', 'statusChangedAt')
  if (!hasCol) {
    await knex.schema.alterTable('clients', (table) => {
      table.timestamp('statusChangedAt', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    })
  }
  await knex.raw(`UPDATE clients SET "statusChangedAt" = "createdAt" WHERE status = 'new' OR status IS NULL`)
  await knex.raw(`UPDATE clients SET "statusChangedAt" = "updatedAt" WHERE status NOT IN ('new') AND status IS NOT NULL`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('clients', (table) => {
    table.dropColumn('statusChangedAt')
  })
}
