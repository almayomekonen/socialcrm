/**
 * Notification Infrastructure — P1 storage 3/6: one row per channel attempt.
 *
 * Spec: docs/notification-infrastructure-spec.md §18.3 (DDL) and §21.1 (indexes).
 *
 * Dependency order: MUST run after 20260811120002_create_notifications, which
 * this table references.
 *
 * Two honesty properties are encoded here:
 *
 * 1. `delivered` is only ever written where the channel genuinely reports it
 *    (email via Resend events). Push and in-app record `sent` — claiming a
 *    delivery we cannot observe would be a data-honesty violation (spec §18.3).
 *
 * 2. A suppressed delivery is RECORDED, not dropped: `status = 'suppressed'`
 *    plus `suppressionReason` plus `groupedIntoDeliveryId`. "Why didn't I get a
 *    push?" must always be answerable from data (spec §11). P1 writes in_app
 *    rows only; the other channels and grouping arrive in P3/P4 against this
 *    same shape.
 *
 * ROLLBACK POLICY: valid ONLY before the first live notification is delivered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id bigserial PRIMARY KEY,
      "notificationId" bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      channel text NOT NULL
        CHECK (channel IN ('in_app','toast','web_push','email')),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sent','delivered','failed','suppressed')),
      attempts integer NOT NULL DEFAULT 0,
      "failureReason" text,
      "suppressionReason" text,
      "groupedIntoDeliveryId" bigint REFERENCES notification_deliveries(id) ON DELETE SET NULL,
      "providerMessageId" text,
      "queuedAt" timestamptz NOT NULL DEFAULT now(),
      "sentAt" timestamptz,
      "deliveredAt" timestamptz,
      "failedAt" timestamptz
    )`)

  await knex.raw(`CREATE INDEX IF NOT EXISTS notification_deliveries_notification_idx
      ON notification_deliveries ("notificationId")`)

  // Channel dispatch scan — partial on pending (P3 readers; schema ships now).
  await knex.raw(`CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx
      ON notification_deliveries (channel, "queuedAt") WHERE status = 'pending'`)
}

/**
 * Valid ONLY pre-first-delivery (see header).
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS notification_deliveries`)
}
