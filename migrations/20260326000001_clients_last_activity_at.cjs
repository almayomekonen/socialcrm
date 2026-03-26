exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('clients', 'lastActivityAt')
  if (!hasColumn) {
    await knex.schema.table('clients', (t) => {
      t.timestamp('lastActivityAt').nullable().defaultTo(null)
    })
  }
}

exports.down = async function (knex) {
  await knex.schema.table('clients', (t) => {
    t.dropColumn('lastActivityAt')
  })
}
