/**
 * Facebook User Login — `users.facebookSub` (nullable unique Facebook user id).
 *
 * Additive only. No backfill. Existing rows stay NULL. Postgres UNIQUE allows
 * multiple NULLs, so email / Google / magic-link users are unaffected.
 * Registration, onboarding, invitations, and email uniqueness are unchanged.
 *
 * Facebook identity is attached only from a server-verified `fb_login` proof
 * during registration — never from client input, URL, or localStorage.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "facebookSub" text
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_facebookSub_unique"
      ON users ("facebookSub")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS "users_facebookSub_unique"`)
  await knex.raw(`DROP INDEX IF EXISTS users_facebooksub_unique`)
  await knex.raw(`
    ALTER TABLE users
      DROP COLUMN IF EXISTS "facebookSub"
  `)
}
