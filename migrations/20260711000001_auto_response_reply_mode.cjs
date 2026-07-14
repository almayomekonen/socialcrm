/**
 * Auto Response — reply mode (AI vs fixed message) + optional send delay.
 * Additive on auto_response_settings. Defaults preserve today's AI acknowledge path.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const add = async (col, ddl) => {
    const has = await knex.schema.hasColumn('auto_response_settings', col)
    if (!has) await knex.raw(`ALTER TABLE auto_response_settings ADD COLUMN ${ddl}`)
  }
  await add('replyMode', `"replyMode" text NOT NULL DEFAULT 'ai'`)
  await add('fixedBody', `"fixedBody" text`)
  await add('delaySeconds', `"delaySeconds" integer NOT NULL DEFAULT 0`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const col of ['replyMode', 'fixedBody', 'delaySeconds']) {
    const has = await knex.schema.hasColumn('auto_response_settings', col)
    if (has) await knex.raw(`ALTER TABLE auto_response_settings DROP COLUMN "${col}"`)
  }
}
