/**
 * Persist whether a WhatsApp connection was onboarded via Cloud API or
 * WhatsApp Business App Coexistence.
 *
 * Required for reconnect safety (never re-call POST /register or the one-shot
 * smb_app_data sync) and observability. Additive and nullable: existing rows
 * stay valid with onboarding_type NULL until the next successful connect.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('whatsapp_connections', 'onboarding_type')
  if (has) return
  await knex.schema.alterTable('whatsapp_connections', (table) => {
    table.string('onboarding_type', 32).nullable()
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('whatsapp_connections', 'onboarding_type')
  if (!has) return
  await knex.schema.alterTable('whatsapp_connections', (table) => {
    table.dropColumn('onboarding_type')
  })
}
