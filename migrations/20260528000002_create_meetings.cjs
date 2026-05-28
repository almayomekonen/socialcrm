/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('meetings', (table) => {
    table.increments('id').primary()
    // Denormalized for tenant-isolation guards.
    table.integer('agency_id').notNullable()
    // The CRM user who scheduled the meeting.
    table
      .integer('organizer_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
    // Soft link to the lead (`clients` table per the single-entity rule).
    // Nullable: ad-hoc meetings without a lead are allowed. CASCADE matches
    // the lead_drive_files pattern — removing a lead removes its meetings.
    // The Google event continues to exist (cleanup is a separate concern).
    table.integer('lead_id').references('id').inTable('clients').onDelete('CASCADE')

    table.string('title', 255).notNullable()
    table.text('description')
    table.string('location', 255)
    // IANA timezone of the organizer at creation (e.g. 'Asia/Jerusalem').
    // Stored explicitly so DST transitions never shift existing meetings.
    table.string('timezone', 64).notNullable()
    table.timestamp('start_at', { useTz: true }).notNullable()
    table.timestamp('end_at', { useTz: true }).notNullable()

    // 'scheduled' | 'cancelled' | 'completed'
    table.string('status', 32).notNullable().defaultTo('scheduled')

    // Google Meet URL pulled from conferenceData.entryPoints after push.
    table.text('meet_url')

    // Google Calendar event id (calendar-scoped) — populated after push,
    // used for subsequent update/delete operations.
    table.string('google_event_id', 1024)
    // iCalUID is stable across calendars and exports. Stored for Phase 2
    // pull-sync dedupe; not written-against in Phase 1.
    table.string('google_ical_uid', 1024)

    // 'pending' | 'synced' | 'failed' | 'reauth_required'
    table.string('sync_status', 32).notNullable().defaultTo('pending')
    table.integer('sync_attempts').notNullable().defaultTo(0)
    table.text('sync_error')

    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
    // Maintained at the app layer (no DB trigger), matching the codebase
    // convention. Drives the retry sweep query in Phase 1.5.
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now())

    // Primary read path: "my meetings in a date range" on the calendar
    // page and lead detail.
    table.index(
      ['agency_id', 'organizer_user_id', 'start_at'],
      'meetings_agency_organizer_start_idx',
    )
    // Lead detail page: meetings for this lead.
    table.index('lead_id', 'meetings_lead_id_idx')
    // Retry sweep (Phase 1.5): find meetings still pending/failed.
    table.index('sync_status', 'meetings_sync_status_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('meetings')
}
