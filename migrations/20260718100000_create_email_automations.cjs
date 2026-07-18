/**
 * Email Automation System — persistence.
 *
 * `email_automation_sends`: one row per (automation, user, period) recording a
 * lifecycle-email decision. UNIQUE (automationKey, userId, periodKey) is the
 * send-once / per-period idempotency key; the dispatcher claims a 'pending' row
 * before sending and flips it to 'sent' (a failed send deletes the claim).
 *
 * `email_suppressions`: per-user opt-out. A row (scope 'all') means the user is
 * unsubscribed from lifecycle emails; transactional emails ignore it.
 *
 * Additive and backward-compatible: no existing table is altered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasSends = await knex.schema.hasTable('email_automation_sends')
  if (!hasSends) {
    await knex.schema.createTable('email_automation_sends', (t) => {
      t.bigIncrements('id')
      t.text('automationKey').notNullable()
      t.integer('userId').notNullable()
      t.integer('agencyId').notNullable()
      t.text('periodKey').notNullable().defaultTo('')
      t.text('status').notNullable() // 'pending' | 'sent'
      t.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(knex.fn.now())
      t.timestamp('updatedAt', { useTz: true }).notNullable().defaultTo(knex.fn.now())
      t.unique(['automationKey', 'userId', 'periodKey'])
      t.index(['automationKey', 'createdAt'])
    })
  }

  const hasSuppressions = await knex.schema.hasTable('email_suppressions')
  if (!hasSuppressions) {
    await knex.schema.createTable('email_suppressions', (t) => {
      t.bigIncrements('id')
      t.integer('userId').notNullable()
      t.text('scope').notNullable().defaultTo('all')
      t.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(knex.fn.now())
      t.unique(['userId', 'scope'])
    })
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('email_automation_sends')
  await knex.schema.dropTableIfExists('email_suppressions')
}
