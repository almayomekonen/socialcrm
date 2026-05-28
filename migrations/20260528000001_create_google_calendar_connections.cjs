/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('google_calendar_connections', (table) => {
    table.increments('id').primary()
    // One Google Calendar connection per CRM user, mirroring
    // google_drive_connections. Multi-account support is deferred.
    table
      .integer('user_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
    // Denormalized for tenant-isolation guards on SELECT/DELETE,
    // matching the google_drive_connections / lead_drive_files pattern.
    table.integer('agency_id').notNullable()
    table.string('google_sub', 64).notNullable()
    table.string('google_email', 255).notNullable()
    // access_token and refresh_token are ciphertext (AES-256-GCM, base64).
    // See lib/crypto/secrets.ts for the wire format.
    table.text('access_token').notNullable()
    table.text('refresh_token').notNullable()
    table.timestamp('expires_at', { useTz: true }).notNullable()
    table.text('scope').notNullable()
    // 'primary' for the user's main calendar. Captured explicitly so a
    // future change to a non-primary calendar doesn't silently misroute.
    table.string('primary_calendar_id', 255).notNullable().defaultTo('primary')
    // 'active' | 'reauth_required' | 'disabled'
    // Flipped to 'reauth_required' when refresh returns invalid_grant —
    // the UI surfaces a reconnect banner in that state.
    table.string('sync_status', 32).notNullable().defaultTo('active')
    table.text('last_error')
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
    table.index('agency_id', 'google_calendar_connections_agency_id_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('google_calendar_connections')
}
