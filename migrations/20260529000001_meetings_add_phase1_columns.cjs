/**
 * Phase 1 column additions to the `meetings` table.
 *
 *   - internal_notes      CRM-only annotation; NEVER synced to Google.
 *   - reminder_overrides  Mirrors Google's reminders.overrides shape so the
 *                         action layer can pass it through to events.insert
 *                         / events.patch with no transformation.
 *   - etag                Last seen Google etag, used as `If-Match` for
 *                         optimistic-concurrency on events.patch. NULL on
 *                         meetings created before the etag column existed,
 *                         in which case patches go through last-write-wins.
 *   - completed_at        Set when the organizer marks the meeting completed.
 *   - no_show_at          Set when the organizer marks the meeting as no-show.
 *   - last_refreshed_at   Set when "Refresh from Google" pulls the latest
 *                         snapshot. Surfaces in the UI as "updated …".
 *
 * No CHECK constraint is added to `status` — the column is string(32) per
 * the existing convention; the TS union widens to include 'no_show' at the
 * application layer. Validation lives at the server-action boundary.
 *
 * All columns nullable: existing rows get NULL on apply, reads stay null-safe,
 * and the migration is metadata-only (no table rewrite, no backfill).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('meetings', (table) => {
    table.text('internal_notes')
    table.jsonb('reminder_overrides')
    table.string('etag', 256)
    table.timestamp('completed_at', { useTz: true })
    table.timestamp('no_show_at', { useTz: true })
    table.timestamp('last_refreshed_at', { useTz: true })
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('meetings', (table) => {
    table.dropColumn('last_refreshed_at')
    table.dropColumn('no_show_at')
    table.dropColumn('completed_at')
    table.dropColumn('etag')
    table.dropColumn('reminder_overrides')
    table.dropColumn('internal_notes')
  })
}
