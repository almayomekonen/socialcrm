/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('meeting_attendees', (table) => {
    table.increments('id').primary()
    table
      .integer('meeting_id')
      .notNullable()
      .references('id')
      .inTable('meetings')
      .onDelete('CASCADE')
    // Email is the canonical identifier — internal users and external
    // contacts use the same column. Stored as entered for display; the
    // app layer normalizes (lowercase + trim) before insert so the
    // (meeting_id, email) unique constraint behaves predictably.
    table.string('email', 255).notNullable()
    table.string('display_name', 255)
    // Soft link to a CRM user when the attendee is internal. NULL for
    // external attendees.
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL')
    // Soft link to a lead (`clients`) when the attendee is the lead the
    // meeting is with.
    table.integer('lead_id').references('id').inTable('clients').onDelete('SET NULL')
    // Mirrors RFC 5545 / Google's responseStatus:
    // 'needsAction' | 'accepted' | 'declined' | 'tentative'
    table.string('response_status', 32).notNullable().defaultTo('needsAction')
    table.boolean('is_organizer').notNullable().defaultTo(false)
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())

    // One row per (meeting, email). Re-adding the same attendee is a
    // no-op — see the upsert in the DB helper (db/meetingAttendees.ts).
    table.unique(['meeting_id', 'email'], {
      indexName: 'meeting_attendees_meeting_email_unique',
    })
    table.index('meeting_id', 'meeting_attendees_meeting_id_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('meeting_attendees')
}
