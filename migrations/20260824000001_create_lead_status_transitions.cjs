/**
 * Lead status transition log — the durable record of pipeline movement.
 *
 * WHY THIS TABLE EXISTS. `clients.statusChangedAt` holds only the LATEST change,
 * so the previous status is overwritten the moment a lead moves again. The
 * automation engine's `status_changed` trigger event is transient — it is
 * dropped at `no_active_definitions`, which is the common case — and
 * `notifications` rows are pruned after 90 days. Between them, nothing in the
 * product records that a lead moved from A to B. Stage-to-stage conversion,
 * pipeline velocity, stage duration and bottleneck analysis are therefore not
 * computable at all, and every day without this table is history permanently
 * lost.
 *
 * WRITTEN FROM EXACTLY ONE PLACE: lib/automations/statusChanged.ts, the shared
 * emitter every status-writing surface already routes through. It joins the
 * caller's transaction when there is one, so a rolled-back status write logs
 * nothing.
 *
 * The unique index mirrors the automation engine's existing occurrence key
 * (`status_changed:{newStatus}:{occurredAtMs}`), so a retried server action
 * re-inserts nothing rather than duplicating history.
 *
 * `agencyId` is stored on the row so every read is agency-scoped without a join.
 * ON DELETE CASCADE keeps history from outliving its lead.
 *
 * Additive and reversible. Nothing reads from it yet.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS lead_status_transitions (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      "fromStatus" text,                              -- null = first-ever status, or origin unknown
      "toStatus" text NOT NULL,
      "occurredAt" timestamptz NOT NULL,              -- the business moment; same value written to statusChangedAt
      "actorUserId" integer,                          -- null = system actor
      source text NOT NULL,                           -- 'manual' | 'outcome' | 'sale' | 'system'
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // Idempotency: the same occurrence (lead + destination + business moment) can
  // only ever be recorded once, however many times its action is retried.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS lead_status_transitions_occurrence_uniq
      ON lead_status_transitions ("leadId", "toStatus", "occurredAt")`)

  // Agency-scoped time-series reads (baselines, conversion windows).
  await knex.raw(`CREATE INDEX IF NOT EXISTS lead_status_transitions_agency_occurred_idx
      ON lead_status_transitions ("agencyId", "occurredAt" DESC)`)

  // Per-lead history, oldest first (stage duration for one lead).
  await knex.raw(`CREATE INDEX IF NOT EXISTS lead_status_transitions_lead_occurred_idx
      ON lead_status_transitions ("leadId", "occurredAt")`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS lead_status_transitions`)
}
