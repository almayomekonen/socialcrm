/**
 * Notification Infrastructure — P1 storage 5/6: per-user channel preferences.
 *
 * Spec: docs/notification-infrastructure-spec.md §18.5 (DDL), §17 (semantics).
 *
 * Created in P1; the preferences UI is P3. Nothing writes to it until then, and
 * that is the design rather than a gap:
 *
 *   ABSENCE OF A ROW MEANS "ALL DEFAULTS" (spec §17). A user with no rows at all
 *   gets the full §19 policy matrix. Rows exist ONLY where a user deliberately
 *   deviated. So the product works correctly out of the box, requires zero
 *   configuration, and this table stays near-empty in practice.
 *
 * `email: true` here means "allowed to receive email for this category WHEN
 * POLICY CALLS FOR IT" — it does not widen the §16 email policy. Preferences can
 * only ever subtract from what policy already selected (spec §15.1 intersection).
 *
 * TOAST is deliberately absent from the channel columns: a toast is a rendering
 * of IN_APP (spec §13.2), so disabling IN_APP for a category disables its toast.
 * A separate toast toggle would imply a second notification system.
 *
 * ROLLBACK POLICY: valid ONLY before the first live notification is delivered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      category text NOT NULL
        CHECK (category IN ('leads','messages','followups','sla','integrations')),
      "inApp" boolean NOT NULL DEFAULT true,
      "webPush" boolean NOT NULL DEFAULT true,
      email boolean NOT NULL DEFAULT true,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // One row per user per category — the upsert target for the P3 preferences UI.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_category_uniq
      ON notification_preferences ("userId", category)`)
}

/**
 * Valid ONLY pre-first-delivery (see header).
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS notification_preferences`)
}
