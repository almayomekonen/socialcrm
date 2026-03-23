/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.table('facebook_pages', (table) => {
    // 'healthy' | 'token_expired' | 'not_subscribed' | 'unknown'
    table.string('health_status').defaultTo('unknown').notNullable()
    // When the health status was last confirmed (written by webhook or live check)
    table.timestamp('health_checked_at')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.table('facebook_pages', (table) => {
    table.dropColumn('health_status')
    table.dropColumn('health_checked_at')
  })
}
