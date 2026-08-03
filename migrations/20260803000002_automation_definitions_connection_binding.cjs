/**
 * B4 — bind an automation to a Connection and its Sources. Additive.
 *
 * STABLE IDS ONLY, never labels: a phone number's display string, a calendar's
 * name and a page's title all change without warning, and an automation bound
 * to a label silently stops matching. `connectionId` is the connector's stable
 * identity (preserved across re-authorisation — a connector obligation) and
 * `sourceIds` are stable source identities.
 *
 * Both nullable: null connectionId means "not bound to any connection", which
 * is exactly what every existing automation is (its events are `internal`).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasConnection = await knex.schema.hasColumn('automation_definitions', 'connectionId')
  const hasSources = await knex.schema.hasColumn('automation_definitions', 'sourceIds')
  await knex.schema.alterTable('automation_definitions', (t) => {
    if (!hasConnection) t.text('connectionId').nullable()
    if (!hasSources) t.jsonb('sourceIds').notNullable().defaultTo(knex.raw(`'[]'::jsonb`))
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('automation_definitions', (t) => {
    t.dropColumn('connectionId')
    t.dropColumn('sourceIds')
  })
}
