/**
 * C1 — the first production integration: two append-only widenings and one
 * additive column.
 *
 *   `form_submitted`  — the engine trigger behind `form.submitted`. It names an
 *                       OCCURRENCE, not an integration: a Gravity Forms or WPForms
 *                       connector emits the same trigger, distinguished only by
 *                       which connector produced it.
 *   `ownerUserId`     — who inbound leads belong to. Generic: every connector
 *                       that CREATES leads (rather than only matching them)
 *                       needs it, and `insertLeadSystem` requires an owner.
 *
 * Entirely additive: no existing column, constraint value or row changes. The
 * new CHECK lists are strict supersets, so no existing row can fail.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasOwner = await knex.schema.hasColumn('automation_connections', 'ownerUserId')
  if (!hasOwner) {
    await knex.schema.alterTable('automation_connections', (t) => {
      t.integer('ownerUserId').nullable()
    })
  }

  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_trigger_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_trigger_check
      CHECK (trigger IN ('lead_created','status_changed','appointment_booked','form_submitted'));
    ALTER TABLE automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_trigger_check;
    ALTER TABLE automation_jobs ADD CONSTRAINT automation_jobs_trigger_check
      CHECK (trigger IN ('lead_created','status_changed','appointment_booked','form_submitted'));
  `)
}

/**
 * Refuses rather than destroys, for the same reason B7's does: narrowing the
 * CHECK would fail once a row uses the new value, and dropping the column would
 * silently orphan every connection's lead ownership.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  const [{ count: newTriggers }] = await knex('automation_definitions').count({ count: '*' }).where('trigger', 'form_submitted')
  const [{ count: newJobs }] = await knex('automation_jobs').count({ count: '*' }).where('trigger', 'form_submitted')
  const [{ count: owned }] = await knex('automation_connections').count({ count: '*' }).whereNotNull('ownerUserId')

  const blocking = Number(newTriggers) + Number(newJobs) + Number(owned)
  if (blocking > 0) {
    throw new Error(
      `[C1 down] refusing: ${newTriggers} definition(s), ${newJobs} job(s) and ${owned} connection(s) use what ` +
        'this migration added. Remove or re-point them first — rolling back would delete them.',
    )
  }

  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_trigger_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_trigger_check
      CHECK (trigger IN ('lead_created','status_changed','appointment_booked'));
    ALTER TABLE automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_trigger_check;
    ALTER TABLE automation_jobs ADD CONSTRAINT automation_jobs_trigger_check
      CHECK (trigger IN ('lead_created','status_changed','appointment_booked'));
  `)
  await knex.schema.alterTable('automation_connections', (t) => {
    t.dropColumn('ownerUserId')
  })
}
