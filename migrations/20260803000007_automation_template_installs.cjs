/**
 * C4 — the record of what a template created, and from which version.
 *
 * Deliberately a SEPARATE table rather than columns on `automation_definitions`.
 * An installed automation is an ordinary automation: the engine must not be
 * able to tell where it came from, and nothing in the execution path may ever
 * branch on it. Provenance is a marketplace concern, so it lives in the
 * marketplace's own table and is joined only by the marketplace's own UI.
 *
 * `version` is the entire update mechanism: comparing it to the registered
 * template's version is how "a newer version exists" is known, and the absence
 * of any write path from template → definition is how "an update never
 * overwrites a customer edit" is guaranteed structurally rather than by care.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_template_installs (
      id serial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "templateKey" text NOT NULL,
      "templateVersion" integer NOT NULL,
      "automationId" integer NOT NULL REFERENCES automation_definitions(id) ON DELETE CASCADE,
      "installedByUserId" integer,
      "installedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_template_installs_agency_idx
      ON automation_template_installs ("agencyId", "templateKey")`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_template_installs_automation_idx
      ON automation_template_installs ("automationId")`)
}

/**
 * Safe to reverse: dropping this loses the marketplace's memory of what it
 * created, but every automation it created survives untouched — which is
 * precisely the property the separate table exists to guarantee.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS automation_template_installs')
}
