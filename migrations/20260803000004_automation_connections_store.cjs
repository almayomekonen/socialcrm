/**
 * B7 — the generic connection store, and two append-only vocabulary widenings.
 *
 * WhatsApp's Connections are backed by a table that predates the Connection
 * layer. A brand-new integration has no such table, so this adds the GENERIC
 * one every future connector uses: `automation_connections` and
 * `automation_sources`, keyed by `integrationKey`. No per-integration table is
 * ever added again — which is the storage half of "a new integration is a
 * connector plus catalog rows".
 *
 * The CHECK widenings are Law 3 in its literal form: vocabularies are
 * append-only. `appointment_booked` names an OCCURRENCE, not an integration
 * (a Google Calendar connector would emit the same trigger), and the generic
 * `webhook` origin replaces the per-provider pattern going forward so that
 * adding an integration never touches the engine's vocabulary again.
 *
 * Entirely additive: no existing column, constraint value or row is changed.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_connections (
      id serial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "integrationKey" text NOT NULL,
      "externalId" text,
      "displayName" text,
      "accessToken" text,
      "refreshToken" text,
      "webhookSecret" text,
      "expiresAt" timestamptz,
      "revokedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  // One authorisation per external account per agency: a re-authorisation
  // UPDATEs this row, which is what keeps the connection id stable and every
  // automation bound to it working.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_connections_identity_idx
      ON automation_connections ("agencyId", "integrationKey", "externalId")
      WHERE "externalId" IS NOT NULL`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_connections_agency_idx
      ON automation_connections ("agencyId", "integrationKey")`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_sources (
      id serial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "connectionRowId" integer NOT NULL REFERENCES automation_connections(id) ON DELETE CASCADE,
      "externalId" text NOT NULL,
      label text,
      subscription text NOT NULL DEFAULT 'pending'
        CHECK (subscription IN ('subscribed','pending','failed')),
      "revokedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_sources_identity_idx
      ON automation_sources ("connectionRowId", "externalId")`)

  // Append-only widenings. Drop-and-recreate is how Postgres edits a CHECK;
  // the new list is a strict superset of the old one, so no existing row can
  // fail and no persisted value changes meaning.
  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_trigger_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_trigger_check
      CHECK (trigger IN ('lead_created','status_changed','appointment_booked'));
    ALTER TABLE automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_trigger_check;
    ALTER TABLE automation_jobs ADD CONSTRAINT automation_jobs_trigger_check
      CHECK (trigger IN ('lead_created','status_changed','appointment_booked'));
    ALTER TABLE automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_origin_check;
    ALTER TABLE automation_jobs ADD CONSTRAINT automation_jobs_origin_check
      CHECK (origin IN ('webhook_facebook','webhook_whatsapp','webhook','manual','import'));
  `)
}

/**
 * Deliberately REFUSES rather than destroys.
 *
 * Narrowing the CHECKs would fail anyway once a row uses the new values, and
 * dropping the tables would cascade-delete real authorisations. A down
 * migration that silently discards production data is worse than one that
 * stops, so this one stops with an instruction.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  const [{ count: newTriggers }] = await knex('automation_definitions')
    .count({ count: '*' })
    .where('trigger', 'appointment_booked')
  const [{ count: newJobs }] = await knex('automation_jobs')
    .count({ count: '*' })
    .where((q) => q.where('trigger', 'appointment_booked').orWhere('origin', 'webhook'))
  const [{ count: connections }] = await knex('automation_connections').count({ count: '*' })

  const blocking = Number(newTriggers) + Number(newJobs) + Number(connections)
  if (blocking > 0) {
    throw new Error(
      `[B7 down] refusing: ${newTriggers} definition(s), ${newJobs} job(s) and ${connections} connection(s) ` +
        'use the values this migration added. Remove or re-point them first — rolling back would delete them.',
    )
  }

  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_trigger_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_trigger_check
      CHECK (trigger IN ('lead_created','status_changed'));
    ALTER TABLE automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_trigger_check;
    ALTER TABLE automation_jobs ADD CONSTRAINT automation_jobs_trigger_check
      CHECK (trigger IN ('lead_created','status_changed'));
    ALTER TABLE automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_origin_check;
    ALTER TABLE automation_jobs ADD CONSTRAINT automation_jobs_origin_check
      CHECK (origin IN ('webhook_facebook','webhook_whatsapp','manual','import'));
  `)
  await knex.raw('DROP TABLE IF EXISTS automation_sources')
  await knex.raw('DROP TABLE IF EXISTS automation_connections')
}
