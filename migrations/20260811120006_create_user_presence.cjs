/**
 * Notification Infrastructure — P1 storage 6/6: presence.
 *
 * Spec: docs/notification-infrastructure-spec.md §18.6 (DDL), §7.2 (semantics),
 * §18 (why this is not folded into users_info).
 *
 * Created in P1; the writer is the notification feed poll, which is P2. Until
 * then this table is empty, and a user with no row classifies OFFLINE. That is
 * safe rather than merely tolerable: the only channel that treats OFFLINE
 * differently is WEB_PUSH, which requires an opted-in push_subscriptions row
 * that cannot exist before P3 (spec §7.2). P1 sends IN_APP only, which is
 * presence-independent.
 *
 * WHY A DEDICATED TABLE, NOT users_info (spec §18):
 *   · recordLoginActivity does SELECT … FOR UPDATE then an upsert-merge on
 *     users_info.ips. A 30-second-cadence presence write on that same row would
 *     create lock contention and a real clobber risk on login history.
 *   · users_info predates the knex migration history (a Prisma-era base table),
 *     so altering it via knex would deepen the two-migration-system drift that
 *     already breaks DB-backed testing.
 *
 * Narrow by design: no jsonb, few columns, `userId` as the primary key. That
 * makes the 30-second presence write a cheap HOT update instead of a page
 * rewrite, which is the entire point of the separation.
 *
 * ROLLBACK POLICY: valid ONLY before the first live notification is delivered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS user_presence (
      "userId" integer PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
      "lastSeenVisible" boolean NOT NULL DEFAULT true,
      "awaySinceAt" timestamptz,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)
}

/**
 * Valid ONLY pre-first-delivery (see header).
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS user_presence`)
}
