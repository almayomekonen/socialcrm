exports.config = { transaction: false }

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_intelligence_temperature_value_idx
      ON conversation_intelligence ("agencyId", ((data->>'temperature')))
      WHERE kind = 'temperature'
  `)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_intelligence_intent_value_idx
      ON conversation_intelligence ("agencyId", ((data->>'intent')))
      WHERE kind = 'intent'
  `)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_intelligence_action_value_idx
      ON conversation_intelligence ("agencyId", ((data->>'suggestedAction')))
      WHERE kind = 'suggested_action'
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS conversation_intelligence_action_value_idx`)
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS conversation_intelligence_intent_value_idx`)
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS conversation_intelligence_temperature_value_idx`)
}
