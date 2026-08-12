/**
 * Notification Infrastructure — P1 storage 4/6: web push subscriptions.
 *
 * Spec: docs/notification-infrastructure-spec.md §18.4 (DDL), §15.3 (lifecycle),
 * §20.5 (security).
 *
 * Created in P1 with the rest of the schema; NOTHING writes to it until P3. An
 * empty table is exactly what the capability model expects: WEB_PUSH requires
 * at least one active row, so with none, the engine routes around push with no
 * branch and no special case (spec §15.1).
 *
 * Security shape (spec §20.5): `endpoint` is GLOBALLY unique and bound to
 * (agencyId, userId). Re-subscribing an existing endpoint as a different user
 * reassigns it and deletes the prior row — a real device changing hands must
 * never be dual-bound, or it would leak the previous user's notifications. The
 * global uniqueness of `endpoint` is what makes that reassignment enforceable
 * rather than merely intended.
 *
 * ROLLBACK POLICY: valid ONLY before the first live notification is delivered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      endpoint text NOT NULL,
      "p256dh" text NOT NULL,
      auth text NOT NULL,
      "userAgent" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "lastUsedAt" timestamptz,
      "failureCount" integer NOT NULL DEFAULT 0
    )`)

  // One row per endpoint, globally — see header (§20.5 reassignment rule).
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uniq
      ON push_subscriptions (endpoint)`)

  // Capability lookup: "does this user have any subscription?" (multi-device).
  await knex.raw(`CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
      ON push_subscriptions ("userId")`)
}

/**
 * Valid ONLY pre-first-delivery (see header).
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS push_subscriptions`)
}
