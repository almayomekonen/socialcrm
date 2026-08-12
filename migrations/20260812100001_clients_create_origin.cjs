/**
 * Additive clients.createOrigin — durable create-path origin for reconcile silence.
 *
 * NULL = legacy / non-product rows (no data migration fills this column).
 * CHECK allows NULL or one of: manual | facebook | whatsapp | cf7 | import.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS "createOrigin" text
  `)
  // Named CHECK may already exist on re-run; drop-if-exists then add keeps
  // IF NOT EXISTS column adds idempotent across environments.
  await knex.raw(`
    ALTER TABLE clients
      DROP CONSTRAINT IF EXISTS clients_create_origin_check
  `)
  await knex.raw(`
    ALTER TABLE clients
      ADD CONSTRAINT clients_create_origin_check
      CHECK (
        "createOrigin" IS NULL
        OR "createOrigin" IN ('manual', 'facebook', 'whatsapp', 'cf7', 'import')
      )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE clients
      DROP CONSTRAINT IF EXISTS clients_create_origin_check
  `)
  await knex.raw(`
    ALTER TABLE clients
      DROP COLUMN IF EXISTS "createOrigin"
  `)
}
