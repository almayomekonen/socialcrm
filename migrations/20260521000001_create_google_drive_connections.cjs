/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('google_drive_connections', (table) => {
    table.increments('id').primary()
    table
      .integer('user_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
    table.integer('agency_id').notNullable()
    table.string('google_sub', 64).notNullable()
    table.string('google_email', 255).notNullable()
    // access_token and refresh_token are ciphertext (AES-256-GCM, base64).
    // See lib/crypto/secrets.ts for the wire format.
    table.text('access_token').notNullable()
    table.text('refresh_token').notNullable()
    table.timestamp('expires_at', { useTz: true }).notNullable()
    table.text('scope').notNullable()
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
    table.index('user_id', 'google_drive_connections_user_id_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('google_drive_connections')
}
