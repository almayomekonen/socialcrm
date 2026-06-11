/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id          bigserial PRIMARY KEY,
      "agencyId"  integer NOT NULL REFERENCES agencies(id),
      "userId"    integer REFERENCES users(id),
      event       text NOT NULL,
      props       jsonb NOT NULL DEFAULT '{}',
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  // Once-per-agency funnel events are deduped at the DB, not in app logic.
  // upgrade_clicked / subscription_activated are repeatable — excluded.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_once_per_agency
    ON analytics_events ("agencyId", event)
    WHERE event IN ('registration_completed', 'desktop_first_access',
                    'welcome_modal_shown', 'trial_started', 'trial_expired')
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS analytics_events`)
}
