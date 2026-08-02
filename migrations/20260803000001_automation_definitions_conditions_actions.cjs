/**
 * B3 — conditions and the actions list. Additive, zero-downtime, backfilled.
 *
 * Two columns:
 *   conditions jsonb  — the Builder's general condition model, replacing the
 *                       special-cased `targetStatus` / `sourceFilter` inputs.
 *   actions    jsonb  — the actions LIST shape (frozen spec, review finding 3).
 *                       V1 writes exactly one entry; execution stays single.
 *
 * The legacy columns are DELIBERATELY KEPT AND KEPT AUTHORITATIVE for the
 * engine: `targetStatus` feeds the premise-expiry law and `sourceFilter` feeds
 * the emission filter, and B3's rule is that engine behaviour does not change.
 * The Builder writes both — conditions in full, plus the projection onto the
 * legacy columns — so the engine reads exactly what it read yesterday.
 *
 * Backfill lifts every existing automation's intent into the new shape, so no
 * stored automation loses meaning and none needs re-authoring.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasConditions = await knex.schema.hasColumn('automation_definitions', 'conditions')
  const hasActions = await knex.schema.hasColumn('automation_definitions', 'actions')

  await knex.schema.alterTable('automation_definitions', (t) => {
    if (!hasConditions) t.jsonb('conditions').notNullable().defaultTo(knex.raw(`'[]'::jsonb`))
    if (!hasActions) t.jsonb('actions').notNullable().defaultTo(knex.raw(`'[]'::jsonb`))
  })

  // Backfill conditions from the legacy narrowing columns.
  await knex.raw(`
    UPDATE automation_definitions
       SET conditions = (
         SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM (
           SELECT jsonb_build_object('field','newStatus','operator','is','value',"targetStatus") AS c
            WHERE "targetStatus" IS NOT NULL
           UNION ALL
           SELECT jsonb_build_object('field','source','operator','contains','value',"sourceFilter") AS c
            WHERE "sourceFilter" IS NOT NULL
         ) rows
       )
     WHERE conditions = '[]'::jsonb
  `)

  // Backfill the actions list from the single legacy action + its content.
  await knex.raw(`
    UPDATE automation_definitions
       SET actions = jsonb_build_array(
             jsonb_build_object(
               'actionKey', 'email.send',
               'parameters', jsonb_build_object(
                 'subject', COALESCE(content->>'subject',''),
                 'body',    COALESCE(content->>'body','')
               )
             )
           )
     WHERE actions = '[]'::jsonb AND action = 'send_email'
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('automation_definitions', (t) => {
    t.dropColumn('conditions')
    t.dropColumn('actions')
  })
}
