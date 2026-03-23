/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('webhook_failures', (table) => {
    table.increments('id').primary()
    table.string('lead_id').notNullable()
    table.string('page_id').notNullable()
    // 'token_expired' | 'graph_api_error' | 'timeout' | 'db_error'
    table.string('error_type').notNullable()
    table.text('error_detail')
    table.boolean('resolved').defaultTo(false).notNullable()
    table.timestamps(true, true)
  })

  // Index for recovery queries: "give me all unresolved failures for this page"
  await knex.raw(`
    CREATE INDEX webhook_failures_page_unresolved
    ON webhook_failures (page_id)
    WHERE resolved = FALSE
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('webhook_failures')
}
