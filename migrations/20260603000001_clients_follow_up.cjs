/**
 * Follow-Up Engine V1 — additive, backward-compatible.
 *
 * Adds an explicit, snoozable follow-up date per lead plus one optional note.
 * Both columns are nullable with no default and no backfill: every existing
 * lead is NULL and continues to behave exactly as before (SLA-driven urgency).
 * A lead is "due" only when "nextFollowUpAt" IS NOT NULL AND <= NOW().
 *
 * This is one date + one note per lead — deliberately NOT a task system.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasNextFollowUpAt = await knex.schema.hasColumn('clients', 'nextFollowUpAt')
  const hasFollowUpNote = await knex.schema.hasColumn('clients', 'followUpNote')

  await knex.schema.alterTable('clients', (table) => {
    if (!hasNextFollowUpAt) table.timestamp('nextFollowUpAt', { useTz: true }).nullable()
    if (!hasFollowUpNote) table.text('followUpNote').nullable()
  })

  // Partial index keeps the dashboard "due follow-ups" query cheap — only the
  // (typically small) set of leads with an active follow-up is indexed.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS clients_agency_next_followup_idx
    ON clients ("agencyId", "nextFollowUpAt")
    WHERE "nextFollowUpAt" IS NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS clients_agency_next_followup_idx`)
  await knex.schema.alterTable('clients', (table) => {
    table.dropColumn('nextFollowUpAt')
    table.dropColumn('followUpNote')
  })
}
