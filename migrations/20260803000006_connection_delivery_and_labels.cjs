/**
 * C3 — the two things a real business needs that storage could not answer.
 *
 *   DELIVERY   `lastEventAt` / `eventCount` on the generic connection row.
 *              Without them the product cannot tell "connected but nothing has
 *              ever arrived" from "connected and receiving" — and that is the
 *              single most important thing to know while setting a webhook up.
 *              A customer who mistyped the URL currently sees "מחובר" forever.
 *
 *   LABELS     `automation_source_labels` — the name the BUSINESS gives a
 *              source, kept apart from the name the provider reports.
 *              A provider overwrites its own label on every delivery, so
 *              storing the customer's wording in the same column would lose it
 *              on the next webhook. Keyed by the opaque connection id string,
 *              so it works for every connector — including ones whose sources
 *              live in their own tables and never touch automation_sources.
 *
 * Entirely additive. No existing column, constraint or row changes.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasLastEvent = await knex.schema.hasColumn('automation_connections', 'lastEventAt')
  const hasCount = await knex.schema.hasColumn('automation_connections', 'eventCount')
  await knex.schema.alterTable('automation_connections', (t) => {
    if (!hasLastEvent) t.timestamp('lastEventAt', { useTz: true }).nullable()
    if (!hasCount) t.integer('eventCount').notNullable().defaultTo(0)
  })

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_source_labels (
      "agencyId" integer NOT NULL,
      "connectionId" text NOT NULL,
      "sourceId" text NOT NULL,
      label text NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("agencyId", "connectionId", "sourceId")
    )
  `)
}

/**
 * Refuses rather than destroys, like B7's and C1's: dropping the label table
 * would silently discard names the business typed, and dropping the delivery
 * columns would lose the only record that a connection ever worked.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  const [{ count: labels }] = await knex('automation_source_labels').count({ count: '*' })
  const [{ count: delivered }] = await knex('automation_connections').count({ count: '*' }).whereNotNull('lastEventAt')

  const blocking = Number(labels) + Number(delivered)
  if (blocking > 0) {
    throw new Error(
      `[C3 down] refusing: ${labels} source label(s) and ${delivered} connection(s) with delivery history use what ` +
        'this migration added. Rolling back would discard names the business typed and the record that a ' +
        'connection ever received data.',
    )
  }

  await knex.raw('DROP TABLE IF EXISTS automation_source_labels')
  await knex.schema.alterTable('automation_connections', (t) => {
    t.dropColumn('lastEventAt')
    t.dropColumn('eventCount')
  })
}
