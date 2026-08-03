/**
 * B6 — conditions become the sole authority, and the status condition moves
 * onto the field the engine was actually enforcing.
 *
 * B3 lifted the legacy `targetStatus` column into a condition on `newStatus`
 * (snapshot — "the status it moved into"). But the engine never enforced that:
 * its premise-expiry law compared `targetStatus` against the lead's CURRENT
 * status at send time. In catalog terms that is a LIVE condition on `status`,
 * not a snapshot condition on `newStatus`.
 *
 * So this rewrite does not change any automation's behaviour — it records what
 * the behaviour has always been, on the field whose freshness produces it. The
 * general evaluator then reproduces premise-expiry exactly, and the legacy
 * columns can stop being read.
 *
 * The legacy columns are deliberately NOT dropped here. Nothing reads them
 * after this migration, but keeping them for one release means the backfill
 * stays reversible against real production data. Dropping them is a follow-up
 * cleanup once B6 is verified in production.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // Safety net: any row that somehow still has no conditions gets them from
  // the legacy columns before those columns stop being read. Idempotent — B3
  // already did this for every row that existed then.
  await knex.raw(`
    UPDATE automation_definitions
       SET conditions = (
         SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM (
           SELECT jsonb_build_object('field','status','operator','is','value',"targetStatus") AS c
            WHERE "targetStatus" IS NOT NULL
           UNION ALL
           SELECT jsonb_build_object('field','source','operator','contains','value',"sourceFilter") AS c
            WHERE "sourceFilter" IS NOT NULL
         ) rows
       )
     WHERE conditions = '[]'::jsonb
       AND ("targetStatus" IS NOT NULL OR "sourceFilter" IS NOT NULL)
  `)

  // The rewrite: newStatus → status. Field key only; operator and value are
  // untouched, so no automation's meaning changes.
  await knex.raw(`
    UPDATE automation_definitions
       SET conditions = (
         SELECT jsonb_agg(
                  CASE WHEN c->>'field' = 'newStatus'
                       THEN jsonb_set(c, '{field}', '"status"')
                       ELSE c END
                )
           FROM jsonb_array_elements(conditions) c
       )
     WHERE conditions @> '[{"field":"newStatus"}]'::jsonb
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`
    UPDATE automation_definitions
       SET conditions = (
         SELECT jsonb_agg(
                  CASE WHEN c->>'field' = 'status'
                       THEN jsonb_set(c, '{field}', '"newStatus"')
                       ELSE c END
                )
           FROM jsonb_array_elements(conditions) c
       )
     WHERE conditions @> '[{"field":"status"}]'::jsonb
       AND trigger = 'status_changed'
  `)
}
