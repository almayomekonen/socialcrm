/**
 * Notification Infrastructure — P1 storage 2/6: the record of truth.
 *
 * Spec: docs/notification-infrastructure-spec.md §18.2 (DDL) and §21.1 (indexes).
 *
 * One row per RECIPIENT, never one row per event. The bell reads this table and
 * must stay individually truthful: 20 leads while away is 20 rows here, because
 * the user has to work each one. Only the interruption (push/email) is ever
 * grouped, and that happens at the delivery layer (spec §11).
 *
 * Three orthogonal lifecycle timestamps, and the distinctions are load-bearing
 * (spec §8):
 *   seenAt     — SocialCRM itself surfaced it. A web push being displayed by the
 *                OS does NOT set this. Does not clear the badge, does not free
 *                the collapse key.
 *   readAt     — the user explicitly read it. Clears the badge, FREES the
 *                collapse key. Does not mean the work is done.
 *   resolvedAt — the underlying business work actually happened. Stops
 *                escalation. Independent of read state.
 *
 * Runs after notification_jobs and before notification_deliveries, which
 * references this table.
 *
 * ROLLBACK POLICY: valid ONLY before the first live notification is delivered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS notifications (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      type text NOT NULL,
      category text NOT NULL
        CHECK (category IN ('leads','messages','followups','sla','integrations')),
      priority text NOT NULL
        CHECK (priority IN ('critical','high','medium','low','info')),
      title text NOT NULL,
      body text,
      "entityType" text,
      "entityId" bigint,
      "deepLink" text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "collapseKey" text NOT NULL,
      "groupCount" integer NOT NULL DEFAULT 1,
      "escalationLevel" smallint NOT NULL DEFAULT 0,
      "escalatedAt" timestamptz,
      "seenAt" timestamptz,
      "readAt" timestamptz,
      "resolvedAt" timestamptz,
      "resolvedReason" text
        CHECK ("resolvedReason" IS NULL OR "resolvedReason" IN
               ('business_state','superseded','entity_gone','manual')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  /**
   * Dedup / collapse — and the ON CONFLICT target of the upsert.
   *
   * The predicate is `readAt IS NULL`, deliberately NOT `seenAt IS NULL`: a
   * seen-but-unread row must keep absorbing related events, which is how
   * "3 לידים חדשים" becomes "4" in place instead of spawning a second row
   * (spec §10.1). Enforcement is at the database level, so collapse is
   * race-proof no matter how many concurrent webhooks fire. Mirrors the proven
   * recovery_alerts_one_open_per_lead partial-unique pattern.
   */
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS notifications_collapse_open_uniq
      ON notifications ("userId", "collapseKey") WHERE "readAt" IS NULL`)

  // Badge + dropdown (the hot read path).
  await knex.raw(`CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
      ON notifications ("userId", "createdAt" DESC) WHERE "readAt" IS NULL`)

  // Notification center pagination.
  await knex.raw(`CREATE INDEX IF NOT EXISTS notifications_user_created_idx
      ON notifications ("userId", "createdAt" DESC)`)

  /**
   * Escalation scan — only rows that could still escalate.
   *
   * The predicate is "resolvedAt IS NULL" ALONE, deliberately NOT
   * "AND readAt IS NULL": a read-but-unresolved notification MUST keep
   * escalating (spec §8.3). Adding readAt here would silently exclude the single
   * most important escalation case — the user who glanced at a hot lead and did
   * nothing. (Escalation itself is P4; the index ships with the schema.)
   */
  await knex.raw(`CREATE INDEX IF NOT EXISTS notifications_escalation_idx
      ON notifications ("createdAt") WHERE "resolvedAt" IS NULL`)

  // "While you were away" window (P4 reader; schema ships now).
  await knex.raw(`CREATE INDEX IF NOT EXISTS notifications_unseen_idx
      ON notifications ("userId", "createdAt") WHERE "seenAt" IS NULL`)
}

/**
 * Valid ONLY pre-first-delivery (see header).
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS notifications`)
}
