/**
 * Recovery Alerts — additive, backward-compatible.
 *
 * One row per "lead waited too long for a reply" event, plus its resolution.
 * The Recovery Engine (services/automation/recoveryEngine.ts) is the SENSOR —
 * it answers "who is waiting right now". This table is the EVENT RECORD — it
 * remembers that the sensor fired and what happened next (resolved when a rep
 * replies). The two coexist: the engine detects, this table persists history,
 * resolution tracking, and audit trail — none of which a stateless query can
 * express.
 *
 * The partial unique index enforces AT MOST ONE open alert per lead at the DB
 * level, so duplicate prevention is race-proof no matter how many times n8n
 * calls the create endpoint.
 *
 * Reversible: down() drops the table (its indexes go with it).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS recovery_alerts (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      "conversationId" bigint REFERENCES inbox_conversations(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','resolved')),
      "waitingMinutes" integer NOT NULL,
      "lastCustomerMessage" text,
      "lastCustomerMessageAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "resolvedAt" timestamptz
    )
  `)

  // At most one OPEN alert per lead — the duplicate-prevention guarantee.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS recovery_alerts_one_open_per_lead
      ON recovery_alerts ("leadId")
      WHERE status = 'open'
  `)

  // Page query: alerts for an agency, newest first, filterable by status.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS recovery_alerts_agency_status_created_idx
      ON recovery_alerts ("agencyId", status, "createdAt" DESC)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS recovery_alerts`)
}
