/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('whatsapp_connections', (table) => {
    table.increments('id').primary()
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.integer('agency_id').notNullable()
    table.string('phone_number_id', 64).notNullable().unique()
    table.text('access_token').notNullable()
    table.timestamp('created_at').defaultTo(knex.fn.now())
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('whatsapp_connections')
}
