/**
 * Persisted health state for a WhatsApp connection.
 *
 * WHY. `resolveWhatsappHealth` computes an honest eight-state verdict, but it
 * computed it only when a human opened Settings — so a dead token was
 * discovered by a customer, not by the system. The scheduled sweep changes that,
 * and a sweep needs somewhere to remember what it last saw.
 *
 * REMEMBERING IS WHAT MAKES THE NOTIFICATION HONEST. Without a prior state,
 * every sweep observing a broken connection would emit `integration.disconnected`
 * again — the connection would be "newly broken" every hour, forever. Storing
 * the last verdict turns that into a TRANSITION check: notify when the state
 * genuinely changes, stay silent while it merely persists. That is the exact
 * discipline `facebook_pages.health_status` already gives the Facebook side, and
 * these two columns are deliberately its mirror image, same names, same
 * semantics — one pattern, two providers.
 *
 * Defaults to 'unknown', which is what an un-swept connection honestly is.
 * Additive and reversible; nothing reads it until the sweep ships.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const add = async (col, ddl) => {
    const has = await knex.schema.hasColumn('whatsapp_connections', col)
    if (!has) await knex.raw(`ALTER TABLE whatsapp_connections ADD COLUMN ${ddl}`)
  }
  await add('health_status', `health_status varchar(32) NOT NULL DEFAULT 'unknown'`)
  await add('health_checked_at', `health_checked_at timestamptz`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const col of ['health_status', 'health_checked_at']) {
    const has = await knex.schema.hasColumn('whatsapp_connections', col)
    if (has) await knex.raw(`ALTER TABLE whatsapp_connections DROP COLUMN ${col}`)
  }
}
