/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'`)
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "planReason" text`)
  await knex.raw(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "overQuota" boolean NOT NULL DEFAULT false`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE clients DROP COLUMN IF EXISTS "overQuota"`)
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS "planReason"`)
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS plan`)
}
