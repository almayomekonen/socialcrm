/**
 * Lead-intake rejection state on the generic connection row.
 *
 * `lastEventAt` / `eventCount` record VERIFIED deliveries and are written only
 * after `verifyWebhook` passes — deliberately, since a signed payload we chose
 * not to act on still proves the wiring works. The consequence is that a
 * connection which worked yesterday and is being refused today still reads
 * "מקבל אירועים" off a stale `lastEventAt`, reassuring the customer at the exact
 * moment leads are being dropped. These three columns are the missing half of
 * that pair.
 *
 * Doctrine:
 *   - Additive. Three nullable/defaulted columns beside the delivery pair they
 *     mirror; no existing column, value or semantic changes.
 *   - NOT a rejection history table. A rejection is the same fact as a delivery
 *     with the opposite sign, and the counters already live on this row. History
 *     would be a bigger store than anything the UI asks for.
 *   - `consecutiveRejections` is CONSECUTIVE: a verified delivery resets it to
 *     zero, which is what makes "three in a row" true rather than "three ever".
 *     That reset is also the false-positive guard — the endpoint is reachable by
 *     anyone who knows the URL, and a connection still receiving good traffic
 *     can never accumulate a streak.
 *   - `lastRejectionReason` stores the TECHNICAL reason (`invalid_signature`).
 *     It is never rendered; the UI maps it to customer copy and shows only that.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  const has = async (col) => knex.schema.hasColumn('automation_connections', col)
  const [hasAt, hasCount, hasReason] = await Promise.all([
    has('lastRejectedAt'),
    has('consecutiveRejections'),
    has('lastRejectionReason'),
  ])

  await knex.schema.alterTable('automation_connections', (t) => {
    if (!hasAt) t.timestamp('lastRejectedAt', { useTz: true }).nullable()
    if (!hasCount) t.integer('consecutiveRejections').notNullable().defaultTo(0)
    if (!hasReason) t.text('lastRejectionReason').nullable()
  })

  // The banner's question: "does this agency have a connection in a rejection
  // streak?" Partial, because a healthy connection is never scanned for it.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS automation_connections_rejecting_idx
      ON automation_connections ("agencyId")
      WHERE "consecutiveRejections" > 0
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS automation_connections_rejecting_idx`)
  await knex.schema.alterTable('automation_connections', (t) => {
    t.dropColumn('lastRejectedAt')
    t.dropColumn('consecutiveRejections')
    t.dropColumn('lastRejectionReason')
  })
}
