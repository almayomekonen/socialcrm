/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  const col = await knex.raw(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'status'
  `)
  const type = col.rows[0]?.data_type
  if (type === 'text' || type === 'character varying') return

  await knex.raw(`
    ALTER TABLE clients
    ALTER COLUMN status TYPE text
    USING CASE
      WHEN status = true  THEN 'new'
      WHEN status = false THEN 'new'
      ELSE NULL
    END
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE clients
    ALTER COLUMN status TYPE boolean
    USING CASE
      WHEN status IS NOT NULL THEN true
      ELSE NULL
    END
  `)
}
