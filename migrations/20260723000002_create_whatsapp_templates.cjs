/**
 * Sprint 1 — the whatsapp_templates projection table.
 *
 * A local cache/projection of Meta message templates (RFC: Meta is source of
 * truth). One row per (wabaId, name, language) — Meta's identity key — so the
 * webhook/cron reconcile is an idempotent upsert.
 *
 * Two-axis lifecycle (RFC §2): `status` mirrors Meta (pending/approved/rejected/
 * paused/disabled); `archivedAt` is a local, orthogonal visibility flag (RFC §4
 * archive is "a flag, no migration" — so the column is created here).
 *
 * `components`/`variables`/`metadata` are JSONB for forward-compat (media + auth
 * templates need no migration — RFC §11).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "wabaId" varchar(64) NOT NULL,
      "metaTemplateId" varchar(64),
      name varchar(512) NOT NULL,
      "displayTitle" text NOT NULL,
      language varchar(16) NOT NULL DEFAULT 'he',
      category varchar(24) NOT NULL,
      status varchar(24) NOT NULL DEFAULT 'pending',
      "rejectionReason" varchar(64),
      "qualityRating" varchar(16),
      components jsonb NOT NULL DEFAULT '[]'::jsonb,
      "bodyText" text NOT NULL DEFAULT '',
      variables jsonb NOT NULL DEFAULT '[]'::jsonb,
      "archivedAt" timestamptz,
      "createdByUserId" integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Meta's identity key — makes reconcile an idempotent upsert (webhook carries
  // name + language, not our id).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_identity_uniq
      ON whatsapp_templates ("wabaId", name, language)
  `)

  // The list query + header badge counts.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_templates_agency_status_idx
      ON whatsapp_templates ("agencyId", status)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS whatsapp_templates`)
}
