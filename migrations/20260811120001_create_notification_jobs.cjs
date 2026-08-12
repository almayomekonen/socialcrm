/**
 * Notification Infrastructure — P1 storage 1/6: the enqueue queue.
 *
 * Spec: docs/notification-infrastructure-spec.md §18.1 (DDL) and §21.1 (indexes).
 *
 * This is the cheap end of the pipeline. `notifyEvent()` performs ONE guarded
 * INSERT here inside the originating request (~1ms, no joins, no fan-out) and
 * returns; every expensive operation belongs to the worker. Preserving webhook
 * latency is the reason the table exists at all (spec §3).
 *
 * Deliberately a SEPARATE queue from automation_jobs: the automation engine
 * declares its own domain boundary, and coupling two engines through one queue
 * would violate it (spec §3 "Domain boundary"). Same proven shape, own domain.
 *
 * Agencies/leads are referenced by id WITHOUT foreign keys, following the
 * automation engine's precedent — entity references are polymorphic
 * (`entityType` + `entityId`) and orphans are pruned, not cascaded (spec §18).
 *
 * ROLLBACK POLICY: the down-path is valid ONLY before the first live
 * notification is delivered. After that, behavioral rollback is via flags,
 * never schema (spec §23.4).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS notification_jobs (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      type text NOT NULL,
      "eventKey" text NOT NULL,
      "actorUserId" integer,
      "entityType" text NOT NULL,
      "entityId" bigint NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','done','skipped','failed','dead')),
      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 3,
      "notBefore" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      "skipReason" text,
      "lastError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  /**
   * Retry/webhook dedup, and the ON CONFLICT target of the enqueue.
   *
   * This index is also what makes the reconciliation sweep safe (spec §14.3):
   * re-enqueueing an event that already exists is a no-op, so the sweep can run
   * every minute forever with no duplicate risk. `eventKey` is globally unique
   * and therefore carries type + agency + entity in its own text (see
   * lib/notifications/eventKey.ts) — it is never just an entity id.
   */
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_event_uniq
      ON notification_jobs ("eventKey")`)

  // Worker claim scan — partial on pending, by due time (mirrors
  // automation_jobs_claim_idx, the proven house pattern).
  await knex.raw(`CREATE INDEX IF NOT EXISTS notification_jobs_claim_idx
      ON notification_jobs ("notBefore") WHERE status = 'pending'`)

  /**
   * Reconciliation sweep support (spec §14.3). The sweep asks "which leads
   * created in the last N minutes have no lead.created job?", which reads this
   * table by (type, entityId). Not in the spec's index list because the sweep
   * was specified after it; without it the sweep degrades to a seq scan every
   * cron tick.
   */
  await knex.raw(`CREATE INDEX IF NOT EXISTS notification_jobs_type_entity_idx
      ON notification_jobs (type, "entityId")`)
}

/**
 * Valid ONLY pre-first-delivery (see header).
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS notification_jobs`)
}
