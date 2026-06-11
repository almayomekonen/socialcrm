/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "trialStartedAt" timestamptz`)
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "trialEndsAt" timestamptz`)
  await knex.raw(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "trialExempt" boolean NOT NULL DEFAULT false`)
  // Legacy exemption: every agency existing at migration time keeps unchanged
  // access forever. New registrations get false via the column default.
  await knex.raw(`UPDATE agencies SET "trialExempt" = true`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS "trialExempt"`)
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS "trialEndsAt"`)
  await knex.raw(`ALTER TABLE agencies DROP COLUMN IF EXISTS "trialStartedAt"`)
}
