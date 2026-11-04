/**
 * Free-text notes on a lead: what was said on a call, what was agreed.
 *
 * ADDITIVE: one new table, nothing existing is changed. `clients.followUpNote`
 * cannot hold this, because it is erased whenever a follow-up is replaced or
 * cleared. A note belongs to its lead and goes when the lead is deleted; it
 * outlives its author, whose name is kept as written at the time.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('lead_notes', (table) => {
    table.increments('id').primary()
    table.integer('agencyId').notNullable().references('id').inTable('agencies').onDelete('CASCADE')
    table.integer('leadId').notNullable().references('id').inTable('clients').onDelete('CASCADE')
    table.integer('userId').references('id').inTable('users').onDelete('SET NULL')
    table.text('userName').notNullable().defaultTo('')
    table.text('content').notNullable()
    table.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    table.index(['leadId', 'createdAt'], 'lead_notes_lead_created_idx')
    table.index(['agencyId'], 'lead_notes_agency_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('lead_notes')
}
