/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('lead_drive_files', (table) => {
    table.increments('id').primary()
    // The Lead entity lives in `clients` per the codebase's single-entity rule
    // (see CLAUDE.md). CASCADE on lead deletion removes the attachment row;
    // the underlying file in Drive is never touched (no write scope).
    table.integer('lead_id').notNullable().references('id').inTable('clients').onDelete('CASCADE')
    // agency_id is denormalized for tenant-isolation guards on SELECT/DELETE.
    table.integer('agency_id').notNullable()
    table.integer('created_by_user_id').notNullable()
    table.string('drive_file_id', 64).notNullable()
    table.string('name', 255).notNullable()
    table.string('mime_type', 255).notNullable()
    table.text('web_view_link')
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
    // One attachment per (lead, drive file). Re-attaching a file does nothing
    // — see the upsert in the DB helper.
    table.unique(['lead_id', 'drive_file_id'], { indexName: 'lead_drive_files_lead_file_unique' })
    table.index('lead_id', 'lead_drive_files_lead_id_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lead_drive_files')
}
