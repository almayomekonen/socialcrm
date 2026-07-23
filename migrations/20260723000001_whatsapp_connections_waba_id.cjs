/**
 * Sprint 0 — persist the WhatsApp Business Account id on each connection.
 *
 * Template operations target /{waba-id}/message_templates, but the connection
 * row only stored phone_number_id + access_token. This adds the WABA id.
 * Additive, nullable, reversible: an existing connection without a WABA id is
 * simply not template-capable yet (backfilled separately), never broken.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('whatsapp_connections', 'waba_id')
  if (has) return
  await knex.schema.alterTable('whatsapp_connections', (table) => {
    table.string('waba_id', 64).nullable()
    table.index(['waba_id'], 'whatsapp_connections_waba_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('whatsapp_connections', 'waba_id')
  if (!has) return
  await knex.schema.alterTable('whatsapp_connections', (table) => {
    table.dropIndex(['waba_id'], 'whatsapp_connections_waba_idx')
    table.dropColumn('waba_id')
  })
}
